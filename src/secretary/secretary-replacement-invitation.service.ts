import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'crypto';
import {
  AdministrativeRestrictionStatus,
  NotificationChannel,
  NotificationOutboxStatus,
  NotificationType,
  PracticeLocationLifecycleStatus,
  Prisma,
  SecretaryAccessProfile,
  SecretaryInvitationStatus,
  UserAccountStatus,
  UserRole,
} from '../../generated/prisma/client';
import { PasswordSecurityService } from '../auth/security/password-security.service';
import { ProtectedAccountPayloadService } from '../auth/security/protected-account-payload.service';
import { normalizeEmail } from '../auth/security/session-security';
import { PrismaService } from '../prisma/prisma.service';
import { MobileNumberService } from '../security/mobile-number/mobile-number.service';
import { AcceptSecretaryInvitationDto } from './dto/accept-secretary-invitation.dto';
import { CreateSecretaryReplacementInvitationDto } from './dto/create-secretary-replacement-invitation.dto';
import { InspectSecretaryInvitationDto } from './dto/inspect-secretary-invitation.dto';

const INVITATION_LIFETIME_MS = 72 * 60 * 60 * 1000;
const PAYLOAD_PURPOSE = 'secretary-replacement-invitation';
type TransactionClient = Prisma.TransactionClient;
type LockedInvitation = { id: string };

type AccessSelection = {
  accessProfile: SecretaryAccessProfile;
  canManageClinicDetails: boolean;
  canManageServices: boolean;
  canManageBookingQuestions: boolean;
  canManageSchedules: boolean;
  cancelClinicDay: boolean;
  assignDaySecretary: boolean;
};

@Injectable()
export class SecretaryReplacementInvitationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly passwordSecurityService: PasswordSecurityService,
    private readonly protectedPayloadService: ProtectedAccountPayloadService,
    private readonly mobileNumberService: MobileNumberService,
  ) {}

  async create(doctorUserId: string, dto: CreateSecretaryReplacementInvitationDto) {
    const normalizedEmail = normalizeEmail(dto.email);
    const firstName = dto.firstName.trim();
    const lastName = dto.lastName.trim();
    const mobileNumber = this.mobileNumberService.normalize(dto.mobileNumber).canonical;
    const access = this.normalizeAccess(dto);
    const activeInvitationKey = this.hash(
      `SECRETARY_REPLACEMENT_INVITATION|${normalizedEmail}|${dto.practiceLocationId}`,
    );

    return this.prisma.$transaction(async (transaction) => {
      await transaction.$executeRaw`
        SELECT pg_advisory_xact_lock(
          hashtextextended(${`SECRETARY_REPLACEMENT_INVITATION|${normalizedEmail}|${dto.practiceLocationId}`}, 0)
        )
      `;

      const location = await transaction.practiceLocation.findFirst({
        where: { id: dto.practiceLocationId, doctorProfile: { userId: doctorUserId } },
        select: {
          id: true,
          name: true,
          lifecycleStatus: true,
          currentRegularPracticeStaffId: true,
          doctorProfile: {
            select: {
              user: {
                select: {
                  role: true,
                  accountStatus: true,
                  administrativeRestrictionStatus: true,
                },
              },
            },
          },
        },
      });
      if (!location) throw new NotFoundException('Practice location was not found.');
      this.assertEligibleDoctor(location.doctorProfile.user);
      if (location.lifecycleStatus === PracticeLocationLifecycleStatus.PERMANENTLY_DELETED) {
        throw new ConflictException('A permanently deleted practice location cannot replace staff.');
      }
      if (!location.currentRegularPracticeStaffId) {
        throw new ConflictException('This clinic has no current regular Secretary. Use Add Secretary instead.');
      }

      const currentUser = await transaction.user.findFirst({
        where: {
          email: normalizedEmail,
          accountStatus: { not: UserAccountStatus.PERMANENTLY_CLOSED },
        },
        select: {
          id: true,
          role: true,
          accountStatus: true,
          administrativeRestrictionStatus: true,
          emailVerifiedAt: true,
        },
      });
      if (currentUser) {
        if (currentUser.role !== UserRole.SECRETARY) {
          throw new ConflictException('This email belongs to an account that cannot be assigned as a Secretary.');
        }
        return {
          outcome: 'EXISTING_SECRETARY' as const,
          secretaryUserId: currentUser.id,
          eligibleForAssignment:
            currentUser.accountStatus === UserAccountStatus.ACTIVE &&
            currentUser.administrativeRestrictionStatus === AdministrativeRestrictionStatus.NONE &&
            currentUser.emailVerifiedAt !== null,
          requestedAccess: access,
        };
      }

      const now = new Date();
      const oldPending = await transaction.secretaryReplacementInvitation.findFirst({
        where: { activeInvitationKey, status: SecretaryInvitationStatus.PENDING },
      });
      if (oldPending) {
        await transaction.secretaryReplacementInvitation.update({
          where: { id: oldPending.id },
          data: {
            status: SecretaryInvitationStatus.REVOKED,
            revokedAt: now,
            tokenHash: null,
            activeInvitationKey: null,
          },
        });
        await this.cancelPendingOutbox(transaction, oldPending.id, now);
      }

      const token = randomBytes(32).toString('base64url');
      const tokenHash = this.hash(token);
      const expiresAt = new Date(now.getTime() + INVITATION_LIFETIME_MS);
      const invitation = await transaction.secretaryReplacementInvitation.create({
        data: {
          practiceLocationId: location.id,
          invitedByUserId: doctorUserId,
          replacementForPracticeStaffId: location.currentRegularPracticeStaffId,
          normalizedEmail,
          firstName,
          lastName,
          mobileNumber,
          requestedAccessProfile: access.accessProfile,
          requestedCanManageClinicDetails: access.canManageClinicDetails,
          requestedCanManageServices: access.canManageServices,
          requestedCanManageBookingQuestions: access.canManageBookingQuestions,
          requestedCanManageSchedules: access.canManageSchedules,
          requestedCancelClinicDay: access.cancelClinicDay,
          requestedAssignDaySecretary: access.assignDaySecretary,
          tokenHash,
          activeInvitationKey,
          status: SecretaryInvitationStatus.PENDING,
          expiresAt,
          createdAt: now,
        },
      });

      const clinicName = location.name?.trim() || 'the clinic';
      const invitationUrl = this.buildInvitationUrl(token);
      const messageBody = `${firstName}, you were invited to complete Secretary onboarding for a planned replacement at ${clinicName}. Creating your account does not give clinic access until the Doctor confirms the replacement: ${invitationUrl}`;
      await transaction.notificationOutbox.create({
        data: {
          deliveryIdentityKey: this.hash(`${NotificationType.SECRETARY_INVITATION}|REPLACEMENT|${invitation.id}`),
          notificationType: NotificationType.SECRETARY_INVITATION,
          channel: NotificationChannel.EMAIL,
          status: NotificationOutboxStatus.PENDING,
          practiceLocationId: location.id,
          recipientEmailEncrypted: this.protectedPayloadService.encrypt(
            normalizedEmail,
            `${PAYLOAD_PURPOSE}:recipient`,
          ),
          messageBodyEncrypted: this.protectedPayloadService.encrypt(
            messageBody,
            `${PAYLOAD_PURPOSE}:message`,
          ),
          providerIdempotencyKey: `secretary-replacement-invitation:${invitation.id}`,
          nextAttemptAt: now,
          expiresAt,
        },
      });

      return {
        outcome: 'INVITATION_CREATED' as const,
        invitationId: invitation.id,
        expiresAt,
        requestedAccess: access,
      };
    });
  }

  async inspect(dto: InspectSecretaryInvitationDto) {
    const invitation = await this.findUsableInvitation(dto.token);
    return {
      valid: true as const,
      firstName: invitation.firstName,
      clinicName: invitation.practiceLocation.name?.trim() || 'Clinic',
      expiresAt: invitation.expiresAt,
      accessProfile: invitation.requestedAccessProfile,
    };
  }

  async accept(dto: AcceptSecretaryInvitationDto) {
    this.passwordSecurityService.assertValid(dto.password);
    const passwordHash = await this.passwordSecurityService.hash(dto.password);
    const tokenHash = this.hash(dto.token);

    const accepted = await this.prisma.$transaction(async (transaction) => {
      const rows = await transaction.$queryRaw<LockedInvitation[]>(Prisma.sql`
        SELECT "id"
        FROM "SecretaryReplacementInvitation"
        WHERE "tokenHash" = ${tokenHash}
        LIMIT 1
        FOR UPDATE
      `);
      const row = rows[0];
      if (!row) return false;

      const invitation = await transaction.secretaryReplacementInvitation.findUnique({
        where: { id: row.id },
        include: {
          practiceLocation: {
            select: {
              id: true,
              lifecycleStatus: true,
              currentRegularPracticeStaffId: true,
            },
          },
        },
      });
      if (!invitation || invitation.tokenHash !== tokenHash) return false;
      const now = new Date();
      if (
        invitation.status !== SecretaryInvitationStatus.PENDING ||
        invitation.activeInvitationKey === null
      ) return false;

      if (invitation.expiresAt.getTime() <= now.getTime()) {
        await transaction.secretaryReplacementInvitation.update({
          where: { id: invitation.id },
          data: {
            status: SecretaryInvitationStatus.EXPIRED,
            tokenHash: null,
            activeInvitationKey: null,
          },
        });
        await this.cancelPendingOutbox(transaction, invitation.id, now);
        return false;
      }
      if (invitation.practiceLocation.lifecycleStatus === PracticeLocationLifecycleStatus.PERMANENTLY_DELETED) {
        throw new ConflictException('This clinic is no longer available for staffing.');
      }
      if (
        invitation.practiceLocation.currentRegularPracticeStaffId !==
        invitation.replacementForPracticeStaffId
      ) {
        throw new ConflictException(
          'Clinic staffing changed after this invitation was issued. Ask the Doctor to start a new replacement action.',
        );
      }

      await transaction.$executeRaw`
        SELECT pg_advisory_xact_lock(
          hashtextextended(${`CURRENT_USER_EMAIL|${invitation.normalizedEmail}`}, 0)
        )
      `;
      const conflictingUser = await transaction.user.findFirst({
        where: {
          email: invitation.normalizedEmail,
          accountStatus: { not: UserAccountStatus.PERMANENTLY_CLOSED },
        },
        select: { id: true },
      });
      if (conflictingUser) {
        throw new ConflictException(
          'This invitation can no longer be used because an account now exists for this email. Contact the Doctor.',
        );
      }

      const user = await transaction.user.create({
        data: {
          firstName: invitation.firstName,
          lastName: invitation.lastName,
          email: invitation.normalizedEmail,
          mobileNumber: invitation.mobileNumber,
          passwordHash,
          role: UserRole.SECRETARY,
          accountStatus: UserAccountStatus.ACTIVE,
          administrativeRestrictionStatus: AdministrativeRestrictionStatus.NONE,
          emailVerifiedAt: now,
        },
      });

      await transaction.secretaryReplacementInvitation.update({
        where: { id: invitation.id },
        data: {
          status: SecretaryInvitationStatus.ACCEPTED,
          acceptedAt: now,
          acceptedUserId: user.id,
          tokenHash: null,
          activeInvitationKey: null,
        },
      });
      await this.cancelPendingOutbox(transaction, invitation.id, now);
      return true;
    });

    if (!accepted) throw new BadRequestException('Invalid or expired replacement invitation link.');
    return { accepted: true as const, assignmentPendingDoctorConfirmation: true as const };
  }

  async listForLocation(doctorUserId: string, practiceLocationId: string) {
    const location = await this.prisma.practiceLocation.findFirst({
      where: { id: practiceLocationId, doctorProfile: { userId: doctorUserId } },
      select: { id: true, currentRegularPracticeStaffId: true },
    });
    if (!location) throw new NotFoundException('Practice location was not found.');
    if (!location.currentRegularPracticeStaffId) return [];

    const invitations = await this.prisma.secretaryReplacementInvitation.findMany({
      where: {
        practiceLocationId,
        replacementForPracticeStaffId: location.currentRegularPracticeStaffId,
        status: { in: [SecretaryInvitationStatus.PENDING, SecretaryInvitationStatus.ACCEPTED] },
      },
      orderBy: { createdAt: 'desc' },
      include: {
        acceptedUser: {
          select: {
            id: true,
            firstName: true,
            middleName: true,
            lastName: true,
            email: true,
            mobileNumber: true,
            emailVerifiedAt: true,
            accountStatus: true,
            administrativeRestrictionStatus: true,
          },
        },
      },
    });

    return invitations.map((invitation) => ({
      id: invitation.id,
      status: invitation.status,
      firstName: invitation.firstName,
      lastName: invitation.lastName,
      normalizedEmail: invitation.normalizedEmail,
      mobileNumber: invitation.mobileNumber,
      expiresAt: invitation.expiresAt,
      acceptedAt: invitation.acceptedAt,
      acceptedUser: invitation.acceptedUser,
      requestedAccess: {
        accessProfile: invitation.requestedAccessProfile,
        canManageClinicDetails: invitation.requestedCanManageClinicDetails,
        canManageServices: invitation.requestedCanManageServices,
        canManageBookingQuestions: invitation.requestedCanManageBookingQuestions,
        canManageSchedules: invitation.requestedCanManageSchedules,
        cancelClinicDay: invitation.requestedCancelClinicDay,
        assignDaySecretary: invitation.requestedAssignDaySecretary,
      },
    }));
  }

  private normalizeAccess(dto: CreateSecretaryReplacementInvitationDto): AccessSelection {
    if (dto.accessProfile === SecretaryAccessProfile.STANDARD) {
      return {
        accessProfile: dto.accessProfile,
        canManageClinicDetails: false,
        canManageServices: false,
        canManageBookingQuestions: false,
        canManageSchedules: false,
        cancelClinicDay: Boolean(dto.cancelClinicDay),
        assignDaySecretary: Boolean(dto.assignDaySecretary),
      };
    }
    if (dto.accessProfile === SecretaryAccessProfile.FULL_CLINIC_CONFIGURATION) {
      return {
        accessProfile: dto.accessProfile,
        canManageClinicDetails: true,
        canManageServices: true,
        canManageBookingQuestions: true,
        canManageSchedules: true,
        cancelClinicDay: Boolean(dto.cancelClinicDay),
        assignDaySecretary: Boolean(dto.assignDaySecretary),
      };
    }
    return {
      accessProfile: SecretaryAccessProfile.CUSTOM,
      canManageClinicDetails: Boolean(dto.canManageClinicDetails),
      canManageServices: Boolean(dto.canManageServices),
      canManageBookingQuestions: Boolean(dto.canManageBookingQuestions),
      canManageSchedules: Boolean(dto.canManageSchedules),
      cancelClinicDay: Boolean(dto.cancelClinicDay),
      assignDaySecretary: Boolean(dto.assignDaySecretary),
    };
  }

  private async findUsableInvitation(token: string) {
    const tokenHash = this.hash(token);
    const invitation = await this.prisma.secretaryReplacementInvitation.findFirst({
      where: { tokenHash },
      include: { practiceLocation: { select: { name: true } } },
    });
    if (
      !invitation ||
      invitation.status !== SecretaryInvitationStatus.PENDING ||
      invitation.activeInvitationKey === null ||
      invitation.expiresAt.getTime() <= Date.now()
    ) {
      throw new BadRequestException('Invalid or expired replacement invitation link.');
    }
    return invitation;
  }

  private async cancelPendingOutbox(
    transaction: TransactionClient,
    invitationId: string,
    now: Date,
  ) {
    await transaction.notificationOutbox.updateMany({
      where: {
        providerIdempotencyKey: `secretary-replacement-invitation:${invitationId}`,
        status: NotificationOutboxStatus.PENDING,
      },
      data: { status: NotificationOutboxStatus.CANCELLED, cancelledAt: now },
    });
  }

  private assertEligibleDoctor(user: {
    role: UserRole;
    accountStatus: UserAccountStatus;
    administrativeRestrictionStatus: AdministrativeRestrictionStatus;
  }) {
    if (
      user.role !== UserRole.DOCTOR ||
      user.accountStatus !== UserAccountStatus.ACTIVE ||
      user.administrativeRestrictionStatus !== AdministrativeRestrictionStatus.NONE
    ) {
      throw new ForbiddenException('Only an eligible current Doctor may replace a Secretary.');
    }
  }

  private buildInvitationUrl(token: string) {
    const baseUrl = (
      this.configService.get<string>('PUBLIC_APP_BASE_URL') ?? 'http://localhost:5173'
    ).replace(/\/$/, '');
    return `${baseUrl}/secretary-replacement-invitation?token=${encodeURIComponent(token)}`;
  }

  private hash(value: string) {
    return createHash('sha256').update(value, 'utf8').digest('hex');
  }
}
