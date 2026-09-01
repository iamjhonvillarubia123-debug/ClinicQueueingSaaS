import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes, randomUUID } from 'crypto';
import {
  AdministrativeRestrictionStatus,
  NotificationChannel,
  NotificationOutboxStatus,
  NotificationType,
  PracticeStaffCapabilityStatus,
  Prisma,
  SecretaryInvitationAssignmentType,
  SecretaryInvitationStatus,
  SubstituteSecretaryCoverageMode,
  UserAccountStatus,
  UserRole,
} from '../../generated/prisma/client';
import { ProtectedAccountPayloadService } from '../auth/security/protected-account-payload.service';
import { PasswordSecurityService } from '../auth/security/password-security.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateSecretaryInvitationDto,
  SecretaryInvitationAssignmentType as DtoAssignmentType,
} from './dto/create-secretary-invitation.dto';
import { UpdateSecretaryInvitationDto } from './dto/update-secretary-invitation.dto';
import { SubstituteSecretaryCoverageMode as DtoCoverageMode } from './substitute-secretary-coverage.types';

const INVITATION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
const PAYLOAD_PURPOSE = 'secretary-invitation';
type Tx = Prisma.TransactionClient;

@Injectable()
export class SecretaryInvitationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly payload: ProtectedAccountPayloadService,
    private readonly passwords: PasswordSecurityService,
  ) {}

  async create(actorUserId: string, dto: CreateSecretaryInvitationDto) {
    const normalizedEmail = dto.email.trim().toLowerCase();
    const plan = this.validatePlan(dto);
    const actor = await this.prisma.user.findUnique({
      where: { id: actorUserId },
      select: {
        role: true,
        accountStatus: true,
        administrativeRestrictionStatus: true,
        passwordHash: true,
      },
    });
    if (
      !actor ||
      actor.role !== UserRole.DOCTOR ||
      actor.accountStatus !== UserAccountStatus.ACTIVE ||
      actor.administrativeRestrictionStatus !==
        AdministrativeRestrictionStatus.NONE
    )
      throw new ForbiddenException(
        'Only an eligible current Doctor may invite a Secretary.',
      );
    const location = await this.prisma.practiceLocation.findFirst({
      where: {
        id: dto.practiceLocationId,
        doctorProfile: { userId: actorUserId },
      },
      select: { id: true, name: true, currentRegularPracticeStaffId: true },
    });
    if (!location)
      throw new NotFoundException('Practice location was not found.');
    const existingUser = await this.prisma.user.findFirst({
      where: { email: normalizedEmail },
      select: {
        id: true,
        role: true,
        accountStatus: true,
        administrativeRestrictionStatus: true,
        emailVerifiedAt: true,
        firstName: true,
        lastName: true,
        mobileNumber: true,
      },
    });
    if (existingUser && existingUser.role !== UserRole.SECRETARY) {
      throw new ConflictException(
        'This email belongs to an account with an incompatible role.',
      );
    }
    const invitationFirstName = existingUser?.firstName ?? dto.firstName.trim();
    const invitationLastName = existingUser?.lastName ?? dto.lastName.trim();
    const invitationMobileNumber =
      existingUser?.mobileNumber ?? dto.mobileNumber.trim();
    const expectedCurrentPracticeStaffId =
      plan.assignmentType === SecretaryInvitationAssignmentType.CLINIC_SECRETARY
        ? location.currentRegularPracticeStaffId
        : null;
    if (expectedCurrentPracticeStaffId || plan.requestedCancelClinicDay) {
      if (!dto.password)
        throw new UnauthorizedException(
          expectedCurrentPracticeStaffId
            ? 'Current password is required to authorize replacement.'
            : 'Current password is required to grant Cancel Clinic Day authority.',
        );
      if (!(await this.passwords.verify(dto.password, actor.passwordHash)))
        throw new UnauthorizedException('Current password is incorrect.');
    }
    const activeInvitationKey = this.sha256(
      `${location.id}:${normalizedEmail}`,
    );
    if (
      await this.prisma.secretaryInvitation.findUnique({
        where: { activeInvitationKey },
        select: { id: true },
      })
    )
      throw new ConflictException(
        'A pending invitation already exists for this email at this clinic.',
      );
    const token = randomBytes(32).toString('base64url');
    const now = new Date();
    const expiresAt = new Date(now.getTime() + INVITATION_LIFETIME_MS);
    const invitation = await this.prisma.$transaction(async (transaction) => {
      const created = await transaction.secretaryInvitation.create({
        data: {
          practiceLocationId: location.id,
          invitedByUserId: actorUserId,
          normalizedEmail,
          firstName: invitationFirstName,
          lastName: invitationLastName,
          mobileNumber: invitationMobileNumber,
          tokenHash: this.sha256(token),
          activeInvitationKey,
          status: SecretaryInvitationStatus.PENDING,
          expiresAt,
          requestedAssignmentType: plan.assignmentType,
          requestedAuthorityBundles: plan.authorityBundles,
          requestedCancelClinicDay: plan.requestedCancelClinicDay,
          requestedCoverageMode: plan.coverageMode,
          requestedFromServiceDate: plan.fromServiceDate,
          requestedToServiceDate: plan.toServiceDate,
          expectedCurrentPracticeStaffId,
          createdAt: now,
        },
      });
      const url = `${this.publicAppBaseUrl()}/secretary-invitations/accept?token=${encodeURIComponent(token)}`;
      await transaction.notificationOutbox.create({
        data: {
          deliveryIdentityKey: this.sha256(
            `${NotificationType.SECRETARY_INVITATION}:${created.id}`,
          ),
          notificationType: NotificationType.SECRETARY_INVITATION,
          channel: NotificationChannel.EMAIL,
          status: NotificationOutboxStatus.PENDING,
          practiceLocationId: location.id,
          secretaryInvitationId: created.id,
          recipientEmailEncrypted: this.payload.encrypt(
            normalizedEmail,
            `${PAYLOAD_PURPOSE}:recipient`,
          ),
          messageBodyEncrypted: this.payload.encrypt(
            `You have been invited to join ${location.name} as a ${plan.assignmentType === SecretaryInvitationAssignmentType.CLINIC_SECRETARY ? 'Clinic Secretary' : 'Substitute Secretary'}. Create or sign in to your own verified Secretary account, then accept the clinic relationship: ${url}`,
            `${PAYLOAD_PURPOSE}:message`,
          ),
          providerIdempotencyKey: `secretary-invitation:${created.id}`,
          nextAttemptAt: now,
          expiresAt,
        },
      });
      return created;
    });
    return {
      invitationId: invitation.id,
      status: invitation.status,
      expiresAt: invitation.expiresAt,
    };
  }

  async preview(token: string) {
    if (!token)
      throw new BadRequestException('Invalid or expired Secretary invitation.');
    const i = await this.prisma.secretaryInvitation.findFirst({
      where: {
        tokenHash: this.sha256(token),
      },
      select: {
        status: true,
        firstName: true,
        lastName: true,
        normalizedEmail: true,
        expiresAt: true,
        requestedAssignmentType: true,
        requestedAuthorityBundles: true,
        requestedCancelClinicDay: true,
        requestedCoverageMode: true,
        requestedFromServiceDate: true,
        requestedToServiceDate: true,
        practiceLocation: { select: { name: true } },
      },
    });
    if (!i)
      throw new BadRequestException('Invalid or expired Secretary invitation.');
    if (i.status === SecretaryInvitationStatus.REVOKED) {
      return { status: 'CANCELLED' as const };
    }
    if (
      i.status === SecretaryInvitationStatus.EXPIRED ||
      i.expiresAt.getTime() <= Date.now()
    ) {
      return { status: 'EXPIRED' as const };
    }
    if (
      i.status !== SecretaryInvitationStatus.PENDING ||
      !i.requestedAssignmentType
    )
      throw new BadRequestException('Invalid or expired Secretary invitation.');
    return {
      status: 'PENDING' as const,
      name: `${i.firstName} ${i.lastName}`.trim(),
      email: i.normalizedEmail,
      clinicName: i.practiceLocation.name,
      expiresAt: i.expiresAt,
      assignmentType: i.requestedAssignmentType,
      authorityBundles: i.requestedAuthorityBundles,
      requestedCancelClinicDay: i.requestedCancelClinicDay,
      coverageMode: i.requestedCoverageMode,
      fromServiceDate: i.requestedFromServiceDate,
      toServiceDate: i.requestedToServiceDate,
    };
  }

  async updatePending(
    actorUserId: string,
    invitationId: string,
    dto: UpdateSecretaryInvitationDto,
  ) {
    const plan = this.validatePlan(dto);
    const invitation = await this.prisma.secretaryInvitation.findFirst({
      where: {
        id: invitationId,
        status: SecretaryInvitationStatus.PENDING,
        practiceLocation: { doctorProfile: { userId: actorUserId } },
      },
      select: { id: true, expiresAt: true },
    });
    if (!invitation)
      throw new NotFoundException('Pending invitation was not found.');
    if (invitation.expiresAt.getTime() <= Date.now())
      throw new ConflictException('This invitation has expired.');

    const updated = await this.prisma.secretaryInvitation.update({
      where: { id: invitation.id },
      data: {
        requestedAssignmentType: plan.assignmentType,
        requestedAuthorityBundles: plan.authorityBundles,
        requestedCancelClinicDay: plan.requestedCancelClinicDay,
        requestedCoverageMode: plan.coverageMode,
        requestedFromServiceDate: plan.fromServiceDate,
        requestedToServiceDate: plan.toServiceDate,
      },
      select: { id: true, status: true, updatedAt: true },
    });
    return {
      invitationId: updated.id,
      status: updated.status,
      updatedAt: updated.updatedAt,
    };
  }

  async revokePending(actorUserId: string, invitationId: string) {
    const now = new Date();
    const removed = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw<Array<{ id: string }>>(
        Prisma.sql`SELECT "id" FROM "SecretaryInvitation" WHERE "id" = ${invitationId} LIMIT 1 FOR UPDATE`,
      );
      const invitation = await tx.secretaryInvitation.findFirst({
        where: {
          id: invitationId,
          status: SecretaryInvitationStatus.PENDING,
          practiceLocation: { doctorProfile: { userId: actorUserId } },
        },
        select: { id: true },
      });
      if (!invitation) return false;
      await tx.secretaryInvitation.update({
        where: { id: invitation.id },
        data: {
          status: SecretaryInvitationStatus.REVOKED,
          revokedAt: now,
          activeInvitationKey: null,
        },
      });
      await tx.notificationOutbox.updateMany({
        where: {
          secretaryInvitationId: invitation.id,
          status: NotificationOutboxStatus.PENDING,
        },
        data: {
          status: NotificationOutboxStatus.CANCELLED,
          cancelledAt: now,
        },
      });
      return true;
    });
    if (!removed)
      throw new NotFoundException('Pending invitation was not found.');
    return { invitationId, removed: true };
  }

  async accept(authenticatedUserId: string, token: string) {
    if (!token)
      throw new BadRequestException('Invalid or expired Secretary invitation.');
    const tokenHash = this.sha256(token);
    const outcome = await this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>(
        Prisma.sql`SELECT "id" FROM "SecretaryInvitation" WHERE "tokenHash" = ${tokenHash} LIMIT 1 FOR UPDATE`,
      );
      if (!locked[0]) return { kind: 'invalid' as const };
      const i = await tx.secretaryInvitation.findUnique({
        where: { id: locked[0].id },
        include: { notificationOutbox: true },
      });
      if (i?.status === SecretaryInvitationStatus.REVOKED)
        return { kind: 'cancelled' as const };
      if (
        !i ||
        i.status !== SecretaryInvitationStatus.PENDING ||
        i.tokenHash !== tokenHash ||
        !i.activeInvitationKey ||
        !i.requestedAssignmentType
      )
        return { kind: 'invalid' as const };
      const now = new Date();
      if (i.expiresAt <= now) {
        await tx.secretaryInvitation.update({
          where: { id: i.id },
          data: {
            status: SecretaryInvitationStatus.EXPIRED,
            tokenHash: null,
            activeInvitationKey: null,
          },
        });
        return { kind: 'invalid' as const };
      }
      const user = await tx.user.findUnique({
        where: { id: authenticatedUserId },
        select: {
          id: true,
          email: true,
          role: true,
          accountStatus: true,
          administrativeRestrictionStatus: true,
          emailVerifiedAt: true,
        },
      });
      if (!user || user.role !== UserRole.SECRETARY)
        return { kind: 'role' as const };
      if (
        user.accountStatus !== UserAccountStatus.ACTIVE ||
        user.administrativeRestrictionStatus !==
          AdministrativeRestrictionStatus.NONE ||
        !user.emailVerifiedAt
      )
        return { kind: 'ineligible' as const };
      if (user.email.trim().toLowerCase() !== i.normalizedEmail)
        return { kind: 'email' as const };
      const locations = await tx.$queryRaw<
        Array<{
          id: string;
          doctorUserId: string;
          currentRegularPracticeStaffId: string | null;
        }>
      >(
        Prisma.sql`SELECT pl."id", dp."userId" AS "doctorUserId", pl."currentRegularPracticeStaffId" FROM "PracticeLocation" pl INNER JOIN "DoctorProfile" dp ON dp."id" = pl."doctorProfileId" WHERE pl."id" = ${i.practiceLocationId} LIMIT 1 FOR UPDATE OF pl`,
      );
      const location = locations[0];
      if (!location || location.doctorUserId !== i.invitedByUserId)
        return { kind: 'ownership' as const };
      if (
        i.requestedAssignmentType ===
          SecretaryInvitationAssignmentType.CLINIC_SECRETARY &&
        location.currentRegularPracticeStaffId !==
          i.expectedCurrentPracticeStaffId
      )
        return { kind: 'replacement_changed' as const };
      if (
        i.requestedAssignmentType ===
          SecretaryInvitationAssignmentType.CLINIC_SECRETARY &&
        !i.requestedAuthorityBundles.length
      )
        return { kind: 'invalid_plan' as const };
      if (
        i.requestedAssignmentType ===
          SecretaryInvitationAssignmentType.SUBSTITUTE_SECRETARY &&
        (!i.requestedCoverageMode ||
          !i.requestedFromServiceDate ||
          !i.requestedToServiceDate)
      )
        return { kind: 'invalid_plan' as const };
      const assignment = await this.prepareAssignment(
        tx,
        user.id,
        location.id,
        now,
      );
      let coverageId: string | null = null;
      if (
        i.requestedAssignmentType ===
        SecretaryInvitationAssignmentType.CLINIC_SECRETARY
      ) {
        await this.applyClinicPlan(
          tx,
          assignment.id,
          i.invitedByUserId,
          i.requestedAuthorityBundles,
          i.requestedCancelClinicDay,
          now,
        );
        await tx.practiceLocation.update({
          where: { id: location.id },
          data: { currentRegularPracticeStaffId: assignment.id },
        });
        if (
          i.expectedCurrentPracticeStaffId &&
          i.expectedCurrentPracticeStaffId !== assignment.id
        )
          await this.disableOutgoing(
            tx,
            i.expectedCurrentPracticeStaffId,
            i.invitedByUserId,
            location.id,
            now,
          );
      } else {
        if (location.currentRegularPracticeStaffId === assignment.id) {
          throw new ConflictException(
            'The current Clinic Secretary cannot also accept Substitute Secretary coverage for this clinic.',
          );
        }
        const coverageMode = i.requestedCoverageMode;
        const fromServiceDate = i.requestedFromServiceDate;
        const toServiceDate = i.requestedToServiceDate;
        if (!coverageMode || !fromServiceDate || !toServiceDate)
          throw new ConflictException('Invitation coverage plan is invalid.');
        coverageId = await this.createCoverage(
          tx,
          assignment.id,
          location.id,
          i.invitedByUserId,
          coverageMode,
          fromServiceDate,
          toServiceDate,
          now,
        );
      }
      await tx.secretaryInvitation.update({
        where: { id: i.id },
        data: {
          status: SecretaryInvitationStatus.ACCEPTED,
          acceptedAt: now,
          acceptedUserId: user.id,
          tokenHash: null,
          activeInvitationKey: null,
        },
      });
      if (i.notificationOutbox?.status === NotificationOutboxStatus.PENDING)
        await tx.notificationOutbox.update({
          where: { id: i.notificationOutbox.id },
          data: {
            status: NotificationOutboxStatus.CANCELLED,
            cancelledAt: now,
          },
        });
      return {
        kind: 'accepted' as const,
        assignmentType: i.requestedAssignmentType,
        practiceStaffId: assignment.id,
        coverageId,
      };
    });
    if (outcome.kind === 'accepted')
      return {
        accepted: true,
        assignmentType: outcome.assignmentType,
        practiceStaffId: outcome.practiceStaffId,
        coverageId: outcome.coverageId,
      };
    if (outcome.kind === 'role')
      throw new ForbiddenException(
        'Only a signed-in Secretary may accept this invitation.',
      );
    if (outcome.kind === 'ineligible')
      throw new ForbiddenException(
        'Your Secretary account must be active and email-verified before accepting.',
      );
    if (outcome.kind === 'email')
      throw new ForbiddenException(
        'This invitation belongs to a different email address.',
      );
    if (outcome.kind === 'replacement_changed')
      throw new ConflictException(
        'The current Clinic Secretary changed after this invitation was sent. Ask the Doctor to review and send a new invitation.',
      );
    if (outcome.kind === 'ownership')
      throw new ConflictException(
        'The clinic ownership for this invitation is no longer valid.',
      );
    if (outcome.kind === 'invalid_plan')
      throw new ConflictException(
        'This invitation has no valid assignment plan. Ask the Doctor to send a new invitation.',
      );
    if (outcome.kind === 'cancelled')
      throw new ConflictException(
        'This invitation was cancelled by the Doctor and can no longer be accepted.',
      );
    throw new BadRequestException('Invalid or expired Secretary invitation.');
  }

  private validatePlan(
    dto: Pick<
      CreateSecretaryInvitationDto,
      | 'assignmentType'
      | 'authorityBundles'
      | 'requestedCancelClinicDay'
      | 'coverageMode'
      | 'fromServiceDate'
      | 'toServiceDate'
    >,
  ) {
    if (dto.assignmentType === DtoAssignmentType.CLINIC_SECRETARY) {
      const authorityBundles = [...new Set(dto.authorityBundles ?? [])].sort();
      if (!authorityBundles.length)
        throw new BadRequestException(
          'At least one Clinic Secretary authority bundle is required.',
        );
      return {
        assignmentType: SecretaryInvitationAssignmentType.CLINIC_SECRETARY,
        authorityBundles,
        requestedCancelClinicDay: dto.requestedCancelClinicDay === true,
        coverageMode: null,
        fromServiceDate: null,
        toServiceDate: null,
      };
    }
    if (
      dto.assignmentType !== DtoAssignmentType.SUBSTITUTE_SECRETARY ||
      !dto.coverageMode ||
      !dto.fromServiceDate ||
      !dto.toServiceDate
    )
      throw new BadRequestException(
        'A valid assignment type and role-specific configuration are required.',
      );
    const from = this.parseDate(dto.fromServiceDate);
    const to = this.parseDate(dto.toServiceDate);
    if (from > to)
      throw new BadRequestException(
        'Substitute Secretary coverage start date must not be after the end date.',
      );
    if (
      dto.coverageMode === DtoCoverageMode.ONE_SERVICE_DATE &&
      dto.fromServiceDate !== dto.toServiceDate
    )
      throw new BadRequestException(
        'One Clinic Day coverage must use the same Service Date.',
      );
    return {
      assignmentType: SecretaryInvitationAssignmentType.SUBSTITUTE_SECRETARY,
      authorityBundles: [],
      requestedCancelClinicDay: false,
      coverageMode: dto.coverageMode,
      fromServiceDate: from,
      toServiceDate: to,
    };
  }

  private async prepareAssignment(
    tx: Tx,
    userId: string,
    practiceLocationId: string,
    now: Date,
  ) {
    const rows = await tx.$queryRaw<
      Array<{ id: string; staffRole: string; isActive: boolean }>
    >(
      Prisma.sql`SELECT "id", "staffRole", "isActive" FROM "PracticeStaff" WHERE "userId" = ${userId} AND "practiceLocationId" = ${practiceLocationId} LIMIT 1 FOR UPDATE`,
    );
    const existing = rows[0];
    if (existing && existing.staffRole !== 'SECRETARY')
      throw new ConflictException(
        'Existing practice staff role is incompatible.',
      );
    if (existing) {
      if (!existing.isActive)
        await tx.practiceStaff.update({
          where: { id: existing.id },
          data: {
            isActive: true,
            activatedAt: now,
            deactivatedAt: null,
            disconnectedAt: null,
          },
        });
      return { id: existing.id };
    }
    return tx.practiceStaff.create({
      data: {
        userId,
        practiceLocationId,
        staffRole: 'SECRETARY',
        isActive: true,
        activatedAt: now,
        createdAt: now,
      },
      select: { id: true },
    });
  }

  private async applyClinicPlan(
    tx: Tx,
    practiceStaffId: string,
    actorUserId: string,
    bundles: string[],
    cancel: boolean,
    now: Date,
  ) {
    await tx.practiceStaffAuthorityBundle.updateMany({
      where: { practiceStaffId, status: 'ACTIVE' },
      data: { status: 'REVOKED', revokedByUserId: actorUserId, revokedAt: now },
    });
    for (const bundle of bundles)
      await tx.$executeRaw(
        Prisma.sql`INSERT INTO "PracticeStaffAuthorityBundle" ("id", "practiceStaffId", "bundleType", "status", "grantedByUserId", "grantedAt", "createdAt") VALUES (${randomUUID()}, ${practiceStaffId}, CAST(${bundle} AS "PracticeStaffAuthorityBundleType"), 'ACTIVE', ${actorUserId}, ${now}, ${now})`,
      );
    await tx.practiceStaffCapability.updateMany({
      where: {
        practiceStaffId,
        capabilityType: 'CANCEL_CLINIC_DAY',
        status: PracticeStaffCapabilityStatus.ACTIVE,
      },
      data: {
        status: PracticeStaffCapabilityStatus.REVOKED,
        activeCapabilityKey: null,
        revokedByUserId: actorUserId,
        revokedAt: now,
      },
    });
    if (cancel)
      await tx.practiceStaffCapability.create({
        data: {
          practiceStaffId,
          capabilityType: 'CANCEL_CLINIC_DAY',
          status: PracticeStaffCapabilityStatus.ACTIVE,
          activeCapabilityKey: this.sha256(
            `${practiceStaffId}:CANCEL_CLINIC_DAY`,
          ),
          grantedByUserId: actorUserId,
          grantedAt: now,
          createdAt: now,
        },
      });
  }

  private async disableOutgoing(
    tx: Tx,
    practiceStaffId: string,
    actorUserId: string,
    practiceLocationId: string,
    now: Date,
  ) {
    const days = await tx.clinicDay.findMany({
      where: {
        practiceLocationId,
        operatingPracticeStaffId: practiceStaffId,
        status: { in: ['NOT_STARTED', 'DELAYED', 'STARTED'] },
      },
      select: { id: true, serviceDate: true },
    });
    for (const day of days) {
      await tx.clinicDay.update({
        where: { id: day.id },
        data: { operatingPracticeStaffId: null },
      });
      await tx.clinicDayOperatingStaffAudit.create({
        data: {
          clinicDayId: day.id,
          practiceLocationId,
          serviceDate: day.serviceDate,
          changeType: 'CLEARED',
          previousOperatingPracticeStaffId: practiceStaffId,
          actorUserId,
          createdAt: now,
        },
      });
    }
    await tx.practiceStaffCapability.updateMany({
      where: { practiceStaffId, status: 'ACTIVE' },
      data: {
        status: 'REVOKED',
        activeCapabilityKey: null,
        revokedByUserId: actorUserId,
        revokedAt: now,
      },
    });
    await tx.practiceStaffAuthorityBundle.updateMany({
      where: { practiceStaffId, status: 'ACTIVE' },
      data: { status: 'REVOKED', revokedByUserId: actorUserId, revokedAt: now },
    });
    await tx.practiceStaff.update({
      where: { id: practiceStaffId },
      data: { isActive: false, deactivatedAt: now },
    });
  }

  private async createCoverage(
    tx: Tx,
    practiceStaffId: string,
    practiceLocationId: string,
    actorUserId: string,
    mode: SubstituteSecretaryCoverageMode,
    from: Date,
    to: Date,
    now: Date,
  ) {
    await tx.$executeRaw(
      Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`SUBSTITUTE_COVERAGE|${practiceLocationId}`}, 0))`,
    );
    if (
      await tx.substituteSecretaryCoverageDate.findFirst({
        where: {
          practiceLocationId,
          status: 'ACTIVE',
          serviceDate: { gte: from, lte: to },
        },
        select: { id: true },
      })
    )
      throw new ConflictException(
        'Another active Substitute Secretary coverage already applies to one or more selected Service Dates.',
      );
    const coverage = await tx.substituteSecretaryCoverage.create({
      data: {
        practiceLocationId,
        practiceStaffId,
        coverageMode: mode,
        fromServiceDate: from,
        toServiceDate: to,
        status: 'ACTIVE',
        createdByUserId: actorUserId,
        createdAt: now,
      },
      select: { id: true },
    });
    for (
      let cursor = from.getTime();
      cursor <= to.getTime();
      cursor += 86_400_000
    )
      await tx.substituteSecretaryCoverageDate.create({
        data: {
          coverageId: coverage.id,
          practiceLocationId,
          serviceDate: new Date(cursor),
          status: 'ACTIVE',
          createdAt: now,
        },
      });
    return coverage.id;
  }

  private parseDate(value: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value))
      throw new BadRequestException('Service Date must use YYYY-MM-DD.');
    const date = new Date(`${value}T00:00:00.000Z`);
    if (
      Number.isNaN(date.getTime()) ||
      date.toISOString().slice(0, 10) !== value
    )
      throw new BadRequestException(
        'Service Date is not a valid calendar date.',
      );
    return date;
  }
  private publicAppBaseUrl() {
    return (
      this.config.get<string>('PUBLIC_APP_BASE_URL') ?? 'http://localhost:5173'
    ).replace(/\/$/, '');
  }
  private sha256(value: string) {
    return createHash('sha256').update(value, 'utf8').digest('hex');
  }
}
