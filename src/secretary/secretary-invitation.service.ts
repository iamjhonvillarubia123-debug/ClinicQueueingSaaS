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
  PracticeStaffRole,
  Prisma,
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
import { CreateSecretaryInvitationDto } from './dto/create-secretary-invitation.dto';
import { InspectSecretaryInvitationDto } from './dto/inspect-secretary-invitation.dto';

const INVITATION_LIFETIME_MS = 72 * 60 * 60 * 1000;
const INVITATION_PAYLOAD_PURPOSE = 'secretary-invitation';

type TransactionClient = Prisma.TransactionClient;

type LockedInvitation = {
  id: string;
};

@Injectable()
export class SecretaryInvitationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly passwordSecurityService: PasswordSecurityService,
    private readonly protectedPayloadService: ProtectedAccountPayloadService,
    private readonly mobileNumberService: MobileNumberService,
  ) {}

  async create(doctorUserId: string, dto: CreateSecretaryInvitationDto) {
    const normalizedEmail = normalizeEmail(dto.email);
    const firstName = dto.firstName.trim();
    const lastName = dto.lastName.trim();
    const mobileNumber = this.mobileNumberService.normalize(dto.mobileNumber).canonical;
    const activeInvitationKey = this.hash(
      `SECRETARY_INVITATION|${normalizedEmail}|${dto.practiceLocationId}`,
    );

    return this.prisma.$transaction(async (transaction) => {
      await transaction.$executeRaw`
        SELECT pg_advisory_xact_lock(
          hashtextextended(${`SECRETARY_INVITATION|${normalizedEmail}|${dto.practiceLocationId}`}, 0)
        )
      `;

      const location = await transaction.practiceLocation.findFirst({
        where: {
          id: dto.practiceLocationId,
          doctorProfile: { userId: doctorUserId },
        },
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

      if (!location) {
        throw new NotFoundException('Practice location was not found.');
      }
      this.assertEligibleDoctor(location.doctorProfile.user);
      this.assertLocationCanReceiveSecretary(location.lifecycleStatus);

      if (location.currentRegularPracticeStaffId) {
        throw new ConflictException(
          'This practice location already has a current regular secretary. Use the approved replace-secretary workflow instead.',
        );
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
          throw new ConflictException(
            'This email belongs to an account that cannot be assigned as a secretary.',
          );
        }
        return {
          outcome: 'EXISTING_SECRETARY' as const,
          secretaryUserId: currentUser.id,
          eligibleForAssignment:
            currentUser.accountStatus === UserAccountStatus.ACTIVE &&
            currentUser.administrativeRestrictionStatus ===
              AdministrativeRestrictionStatus.NONE &&
            currentUser.emailVerifiedAt !== null,
        };
      }

      const now = new Date();
      const oldPending = await transaction.secretaryInvitation.findFirst({
        where: {
          activeInvitationKey,
          status: SecretaryInvitationStatus.PENDING,
        },
        include: { notificationOutbox: true },
      });

      if (oldPending) {
        await transaction.secretaryInvitation.update({
          where: { id: oldPending.id },
          data: {
            status: SecretaryInvitationStatus.REVOKED,
            revokedAt: now,
            tokenHash: null,
            activeInvitationKey: null,
          },
        });
        await this.cancelPendingOutbox(transaction, oldPending.notificationOutbox?.id, now);
      }

      const token = randomBytes(32).toString('base64url');
      const tokenHash = this.hash(token);
      const expiresAt = new Date(now.getTime() + INVITATION_LIFETIME_MS);

      const invitation = await transaction.secretaryInvitation.create({
        data: {
          practiceLocationId: location.id,
          invitedByUserId: doctorUserId,
          normalizedEmail,
          firstName,
          lastName,
          mobileNumber,
          tokenHash,
          activeInvitationKey,
          status: SecretaryInvitationStatus.PENDING,
          expiresAt,
          createdAt: now,
        },
      });

      const invitationUrl = this.buildInvitationUrl(token);
      const clinicName = location.name?.trim() || 'the clinic';
      const messageBody = `${firstName}, you were invited to join ${clinicName} as a secretary in Clinic Queueing SaaS. Set your password using this secure link: ${invitationUrl}`;
      const deliveryIdentityKey = this.hash(
        `${NotificationType.SECRETARY_INVITATION}|${invitation.id}`,
      );

      await transaction.notificationOutbox.create({
        data: {
          deliveryIdentityKey,
          notificationType: NotificationType.SECRETARY_INVITATION,
          channel: NotificationChannel.EMAIL,
          status: NotificationOutboxStatus.PENDING,
          practiceLocationId: location.id,
          secretaryInvitationId: invitation.id,
          recipientEmailEncrypted: this.protectedPayloadService.encrypt(
            normalizedEmail,
            `${INVITATION_PAYLOAD_PURPOSE}:recipient`,
          ),
          messageBodyEncrypted: this.protectedPayloadService.encrypt(
            messageBody,
            `${INVITATION_PAYLOAD_PURPOSE}:message`,
          ),
          providerIdempotencyKey: `secretary-invitation:${invitation.id}`,
          nextAttemptAt: now,
          expiresAt,
        },
      });

      return {
        outcome: 'INVITATION_CREATED' as const,
        invitationId: invitation.id,
        expiresAt,
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
    };
  }

  async accept(dto: AcceptSecretaryInvitationDto) {
    this.passwordSecurityService.assertValid(dto.password);
    const passwordHash = await this.passwordSecurityService.hash(dto.password);
    const tokenHash = this.hash(dto.token);

    const accepted = await this.prisma.$transaction(async (transaction) => {
      const rows = await transaction.$queryRaw<LockedInvitation[]>(Prisma.sql`
        SELECT "id"
        FROM "SecretaryInvitation"
        WHERE "tokenHash" = ${tokenHash}
        LIMIT 1
        FOR UPDATE
      `);
      const row = rows[0];
      if (!row) return false;

      const invitation = await transaction.secretaryInvitation.findUnique({
        where: { id: row.id },
        include: {
          practiceLocation: {
            select: {
              id: true,
              lifecycleStatus: true,
              currentRegularPracticeStaffId: true,
            },
          },
          notificationOutbox: true,
        },
      });

      if (!invitation || invitation.tokenHash !== tokenHash) return false;
      const now = new Date();
      if (
        invitation.status !== SecretaryInvitationStatus.PENDING ||
        invitation.activeInvitationKey === null
      ) {
        return false;
      }

      if (invitation.expiresAt.getTime() <= now.getTime()) {
        await transaction.secretaryInvitation.update({
          where: { id: invitation.id },
          data: {
            status: SecretaryInvitationStatus.EXPIRED,
            tokenHash: null,
            activeInvitationKey: null,
          },
        });
        await this.cancelPendingOutbox(
          transaction,
          invitation.notificationOutbox?.id,
          now,
        );
        return false;
      }

      this.assertLocationCanReceiveSecretary(
        invitation.practiceLocation.lifecycleStatus,
      );
      if (invitation.practiceLocation.currentRegularPracticeStaffId) {
        throw new ConflictException(
          'This clinic is no longer accepting this invitation. Contact the doctor for a new staffing action.',
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
          'This invitation can no longer be used. Contact the doctor for a new staffing action.',
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

      const practiceStaff = await transaction.practiceStaff.create({
        data: {
          userId: user.id,
          practiceLocationId: invitation.practiceLocationId,
          staffRole: PracticeStaffRole.SECRETARY,
          isActive: true,
        },
      });

      await transaction.practiceLocation.update({
        where: { id: invitation.practiceLocationId },
        data: { currentRegularPracticeStaffId: practiceStaff.id },
      });

      await transaction.secretaryInvitation.update({
        where: { id: invitation.id },
        data: {
          status: SecretaryInvitationStatus.ACCEPTED,
          acceptedAt: now,
          acceptedUserId: user.id,
          tokenHash: null,
          activeInvitationKey: null,
        },
      });

      await this.cancelPendingOutbox(
        transaction,
        invitation.notificationOutbox?.id,
        now,
      );
      return true;
    });

    if (!accepted) {
      throw new BadRequestException('Invalid or expired invitation link.');
    }
    return { accepted: true as const };
  }

  async revoke(doctorUserId: string, invitationId: string) {
    return this.prisma.$transaction(async (transaction) => {
      const rows = await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT si."id"
        FROM "SecretaryInvitation" si
        INNER JOIN "PracticeLocation" pl ON pl."id" = si."practiceLocationId"
        INNER JOIN "DoctorProfile" dp ON dp."id" = pl."doctorProfileId"
        WHERE si."id" = ${invitationId}
          AND dp."userId" = ${doctorUserId}
        LIMIT 1
        FOR UPDATE OF si
      `);
      if (!rows[0]) throw new NotFoundException('Invitation was not found.');

      const invitation = await transaction.secretaryInvitation.findUnique({
        where: { id: invitationId },
        include: { notificationOutbox: true },
      });
      if (!invitation) throw new NotFoundException('Invitation was not found.');
      if (invitation.status !== SecretaryInvitationStatus.PENDING) {
        throw new ConflictException('Only a pending invitation may be revoked.');
      }

      const now = new Date();
      await transaction.secretaryInvitation.update({
        where: { id: invitation.id },
        data: {
          status: SecretaryInvitationStatus.REVOKED,
          revokedAt: now,
          tokenHash: null,
          activeInvitationKey: null,
        },
      });
      await this.cancelPendingOutbox(
        transaction,
        invitation.notificationOutbox?.id,
        now,
      );
      return { revoked: true as const };
    });
  }

  private async findUsableInvitation(token: string) {
    const tokenHash = this.hash(token);
    const invitation = await this.prisma.secretaryInvitation.findFirst({
      where: { tokenHash },
      include: { practiceLocation: { select: { name: true } } },
    });
    if (
      !invitation ||
      invitation.status !== SecretaryInvitationStatus.PENDING ||
      invitation.activeInvitationKey === null ||
      invitation.expiresAt.getTime() <= Date.now()
    ) {
      throw new BadRequestException('Invalid or expired invitation link.');
    }
    return invitation;
  }

  private async cancelPendingOutbox(
    transaction: TransactionClient,
    outboxId: string | undefined,
    now: Date,
  ): Promise<void> {
    if (!outboxId) return;
    await transaction.notificationOutbox.updateMany({
      where: { id: outboxId, status: NotificationOutboxStatus.PENDING },
      data: { status: NotificationOutboxStatus.CANCELLED, cancelledAt: now },
    });
  }

  private assertEligibleDoctor(user: {
    role: UserRole;
    accountStatus: UserAccountStatus;
    administrativeRestrictionStatus: AdministrativeRestrictionStatus;
  }): void {
    if (
      user.role !== UserRole.DOCTOR ||
      user.accountStatus !== UserAccountStatus.ACTIVE ||
      user.administrativeRestrictionStatus !== AdministrativeRestrictionStatus.NONE
    ) {
      throw new ForbiddenException(
        'Only an eligible current doctor may invite a secretary.',
      );
    }
  }

  private assertLocationCanReceiveSecretary(
    status: PracticeLocationLifecycleStatus,
  ): void {
    if (status === PracticeLocationLifecycleStatus.PERMANENTLY_DELETED) {
      throw new ConflictException(
        'A permanently deleted practice location cannot receive staff authority.',
      );
    }
  }

  private buildInvitationUrl(token: string): string {
    const baseUrl = (
      this.configService.get<string>('PUBLIC_APP_BASE_URL') ??
      'http://localhost:5173'
    ).replace(/\/$/, '');
    return `${baseUrl}/secretary-invitation?token=${encodeURIComponent(token)}`;
  }

  private hash(value: string): string {
    return createHash('sha256').update(value, 'utf8').digest('hex');
  }
}
