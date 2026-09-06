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
  AccountLoginIdentifierType,
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
import {
  accountIdentifierIsVerified,
  parseAccountIdentifier,
} from '../auth/security/account-identifier';
import { ProtectedAccountPayloadService } from '../auth/security/protected-account-payload.service';
import { PasswordSecurityService } from '../auth/security/password-security.service';
import { NotificationPayloadService } from '../notification/notification-payload.service';
import { PrismaService } from '../prisma/prisma.service';
import { MobileNumberService } from '../security/mobile-number/mobile-number.service';
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
    private readonly protectedAccountPayload: ProtectedAccountPayloadService,
    private readonly notificationPayload: NotificationPayloadService,
    private readonly passwords: PasswordSecurityService,
    private readonly mobileNumbers: MobileNumberService,
  ) {}

  async create(actorUserId: string, dto: CreateSecretaryInvitationDto) {
    const identifier = parseAccountIdentifier(
      dto.identifier,
      this.mobileNumbers,
    );
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
    ) {
      throw new ForbiddenException(
        'Only an eligible current Doctor may invite a Secretary.',
      );
    }

    const location = await this.prisma.practiceLocation.findFirst({
      where: {
        id: dto.practiceLocationId,
        doctorProfile: { userId: actorUserId },
      },
      select: { id: true, name: true, currentRegularPracticeStaffId: true },
    });
    if (!location) {
      throw new NotFoundException('Practice location was not found.');
    }

    const target = await this.prisma.user.findFirst({
      where: {
        ...(identifier.type === 'EMAIL'
          ? {
              loginIdentifierType: AccountLoginIdentifierType.EMAIL,
              email: identifier.normalized,
            }
          : {
              loginIdentifierType: AccountLoginIdentifierType.MOBILE,
              mobileNumberHash: identifier.mobileHash,
            }),
        accountStatus: { not: UserAccountStatus.PERMANENTLY_CLOSED },
      },
      select: {
        id: true,
        role: true,
        accountStatus: true,
        administrativeRestrictionStatus: true,
        loginIdentifierType: true,
        email: true,
        emailVerifiedAt: true,
        mobileNumber: true,
        mobileNumberHash: true,
        mobileVerifiedAt: true,
        firstName: true,
        lastName: true,
      },
    });

    if (!target) {
      throw new NotFoundException(
        'No Secretary account was found for this email. Please review the email address for possible errors. If the details are correct, ask the Secretary to create and verify an account first.',
      );
    }
    if (target.role !== UserRole.SECRETARY) {
      throw new ConflictException(
        'This email address belongs to an account with an incompatible role.',
      );
    }
    if (
      target.accountStatus !== UserAccountStatus.ACTIVE ||
      target.administrativeRestrictionStatus !==
        AdministrativeRestrictionStatus.NONE ||
      !accountIdentifierIsVerified(target)
    ) {
      throw new ConflictException(
        'The Secretary account must be active and its registered email address must be verified before it can be invited.',
      );
    }

    const expectedCurrentPracticeStaffId =
      plan.assignmentType === SecretaryInvitationAssignmentType.CLINIC_SECRETARY
        ? location.currentRegularPracticeStaffId
        : null;

    if (expectedCurrentPracticeStaffId || plan.requestedCancelClinicDay) {
      if (!dto.password) {
        throw new UnauthorizedException(
          expectedCurrentPracticeStaffId
            ? 'Current password is required to authorize replacement.'
            : 'Current password is required to grant Cancel Clinic Day authority.',
        );
      }
      if (!(await this.passwords.verify(dto.password, actor.passwordHash))) {
        throw new UnauthorizedException('Current password is incorrect.');
      }
    }

    const activeInvitationKey = this.sha256(`${location.id}:${target.id}`);
    if (
      await this.prisma.secretaryInvitation.findUnique({
        where: { activeInvitationKey },
        select: { id: true },
      })
    ) {
      throw new ConflictException(
        'A pending invitation already exists for this Secretary at this clinic.',
      );
    }

    const token = randomBytes(32).toString('base64url');
    const now = new Date();
    const expiresAt = new Date(now.getTime() + INVITATION_LIFETIME_MS);
    const normalizedIdentifier =
      target.loginIdentifierType === AccountLoginIdentifierType.EMAIL
        ? target.email
        : target.mobileNumber;
    if (!normalizedIdentifier) {
      throw new ConflictException(
        'The Secretary account does not have a usable verified login identifier.',
      );
    }

    const invitation = await this.prisma.$transaction(async (transaction) => {
      const created = await transaction.secretaryInvitation.create({
        data: {
          practiceLocationId: location.id,
          invitedByUserId: actorUserId,
          targetUserId: target.id,
          identifierType: target.loginIdentifierType,
          normalizedIdentifier,
          normalizedEmail: target.email,
          firstName: target.firstName,
          lastName: target.lastName,
          mobileNumber: target.mobileNumber,
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
      const message = `You have been invited to join ${location.name ?? 'a clinic'} as a ${plan.assignmentType === SecretaryInvitationAssignmentType.CLINIC_SECRETARY ? 'Clinic Secretary' : 'Substitute Secretary'}. Sign in to your active, verified Secretary account, then accept the clinic relationship: ${url}`;

      await transaction.notificationOutbox.create({
        data: {
          deliveryIdentityKey: this.sha256(
            `${NotificationType.SECRETARY_INVITATION}:${created.id}`,
          ),
          notificationType: NotificationType.SECRETARY_INVITATION,
          channel:
            target.loginIdentifierType === AccountLoginIdentifierType.EMAIL
              ? NotificationChannel.EMAIL
              : NotificationChannel.SMS,
          status: NotificationOutboxStatus.PENDING,
          practiceLocationId: location.id,
          secretaryInvitationId: created.id,
          recipientEmailEncrypted:
            target.loginIdentifierType === AccountLoginIdentifierType.EMAIL &&
            target.email
              ? this.protectedAccountPayload.encrypt(
                  target.email,
                  `${PAYLOAD_PURPOSE}:recipient`,
                )
              : null,
          recipientMobileEncrypted:
            target.loginIdentifierType === AccountLoginIdentifierType.MOBILE &&
            target.mobileNumber
              ? this.mobileNumbers.encryptCanonical(target.mobileNumber)
              : null,
          messageBodyEncrypted:
            this.notificationPayload.encryptMessage(message),
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
    if (!token) {
      throw new BadRequestException('Invalid or expired Secretary invitation.');
    }
    const invitation = await this.prisma.secretaryInvitation.findFirst({
      where: { tokenHash: this.sha256(token) },
      select: {
        status: true,
        firstName: true,
        lastName: true,
        identifierType: true,
        normalizedIdentifier: true,
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
    if (!invitation) {
      throw new BadRequestException('Invalid or expired Secretary invitation.');
    }
    if (invitation.status === SecretaryInvitationStatus.REVOKED) {
      return { status: 'CANCELLED' as const };
    }
    if (
      invitation.status === SecretaryInvitationStatus.EXPIRED ||
      invitation.expiresAt.getTime() <= Date.now()
    ) {
      return { status: 'EXPIRED' as const };
    }
    if (
      invitation.status !== SecretaryInvitationStatus.PENDING ||
      !invitation.requestedAssignmentType
    ) {
      throw new BadRequestException('Invalid or expired Secretary invitation.');
    }
    return {
      status: 'PENDING' as const,
      name: `${invitation.firstName} ${invitation.lastName}`.trim(),
      identifierType: invitation.identifierType,
      identifier: invitation.normalizedIdentifier,
      email: invitation.normalizedEmail,
      clinicName: invitation.practiceLocation.name,
      expiresAt: invitation.expiresAt,
      assignmentType: invitation.requestedAssignmentType,
      authorityBundles: invitation.requestedAuthorityBundles,
      requestedCancelClinicDay: invitation.requestedCancelClinicDay,
      coverageMode: invitation.requestedCoverageMode,
      fromServiceDate: invitation.requestedFromServiceDate,
      toServiceDate: invitation.requestedToServiceDate,
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
      select: {
        id: true,
        expiresAt: true,
        practiceLocationId: true,
        normalizedIdentifier: true,
        requestedAssignmentType: true,
        requestedCancelClinicDay: true,
        practiceLocation: { select: { name: true } },
      },
    });
    if (!invitation) {
      throw new NotFoundException('Pending invitation was not found.');
    }
    if (invitation.expiresAt.getTime() <= Date.now()) {
      throw new ConflictException('This invitation has expired.');
    }
    if (invitation.requestedAssignmentType !== plan.assignmentType) {
      throw new ConflictException(
        'A pending invitation cannot change between Clinic Secretary and Substitute Secretary. Cancel it and create a new invitation instead.',
      );
    }

    const grantingCancelClinicDay =
      !invitation.requestedCancelClinicDay && plan.requestedCancelClinicDay;
    if (grantingCancelClinicDay) {
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
      ) {
        throw new ForbiddenException(
          'Only an eligible current Doctor may update this invitation.',
        );
      }
      if (!dto.password) {
        throw new UnauthorizedException(
          'Current password is required to grant Cancel Clinic Day authority.',
        );
      }
      if (!(await this.passwords.verify(dto.password, actor.passwordHash))) {
        throw new UnauthorizedException('Current password is incorrect.');
      }
    }

    const correctedIdentifier = dto.identifier?.trim().toLowerCase();
    if (
      correctedIdentifier &&
      correctedIdentifier !== invitation.normalizedIdentifier
    ) {
      const target = await this.prisma.user.findFirst({
        where: {
          loginIdentifierType: AccountLoginIdentifierType.EMAIL,
          email: correctedIdentifier,
          accountStatus: { not: UserAccountStatus.PERMANENTLY_CLOSED },
        },
        select: {
          id: true,
          role: true,
          accountStatus: true,
          administrativeRestrictionStatus: true,
          loginIdentifierType: true,
          email: true,
          emailVerifiedAt: true,
          mobileNumber: true,
          mobileNumberHash: true,
          mobileVerifiedAt: true,
          firstName: true,
          lastName: true,
        },
      });

      if (!target) {
        throw new NotFoundException(
          'No Secretary account was found for this email. Please review the email address for possible errors. If the details are correct, ask the Secretary to create and verify an account first.',
        );
      }
      if (target.role !== UserRole.SECRETARY) {
        throw new ConflictException(
          'This email address belongs to an account with an incompatible role.',
        );
      }
      if (
        target.accountStatus !== UserAccountStatus.ACTIVE ||
        target.administrativeRestrictionStatus !==
          AdministrativeRestrictionStatus.NONE ||
        !accountIdentifierIsVerified(target) ||
        !target.email
      ) {
        throw new ConflictException(
          'The Secretary account must be active and its registered email address must be verified before it can be invited.',
        );
      }
      const targetEmail = target.email;

      const activeInvitationKey = this.sha256(
        `${invitation.practiceLocationId}:${target.id}`,
      );
      const duplicate = await this.prisma.secretaryInvitation.findUnique({
        where: { activeInvitationKey },
        select: { id: true },
      });
      if (duplicate && duplicate.id !== invitation.id) {
        throw new ConflictException(
          'A pending invitation already exists for this Secretary at this clinic.',
        );
      }

      const token = randomBytes(32).toString('base64url');
      const now = new Date();
      const url = `${this.publicAppBaseUrl()}/secretary-invitations/accept?token=${encodeURIComponent(token)}`;
      const message = `You have been invited to join ${invitation.practiceLocation.name ?? 'a clinic'} as a ${plan.assignmentType === SecretaryInvitationAssignmentType.CLINIC_SECRETARY ? 'Clinic Secretary' : 'Substitute Secretary'}. Sign in to your active, verified Secretary account, then accept the clinic relationship: ${url}`;

      const updated = await this.prisma.$transaction(async (transaction) => {
        const retargeted = await transaction.secretaryInvitation.update({
          where: { id: invitation.id },
          data: {
            targetUserId: target.id,
            identifierType: AccountLoginIdentifierType.EMAIL,
            normalizedIdentifier: targetEmail,
            normalizedEmail: targetEmail,
            firstName: target.firstName,
            lastName: target.lastName,
            mobileNumber: target.mobileNumber,
            tokenHash: this.sha256(token),
            activeInvitationKey,
            requestedAssignmentType: plan.assignmentType,
            requestedAuthorityBundles: plan.authorityBundles,
            requestedCancelClinicDay: plan.requestedCancelClinicDay,
            requestedCoverageMode: plan.coverageMode,
            requestedFromServiceDate: plan.fromServiceDate,
            requestedToServiceDate: plan.toServiceDate,
          },
          select: { id: true, status: true, updatedAt: true },
        });

        await transaction.notificationOutbox.updateMany({
          where: { secretaryInvitationId: invitation.id },
          data: {
            channel: NotificationChannel.EMAIL,
            status: NotificationOutboxStatus.PENDING,
            recipientEmailEncrypted: this.protectedAccountPayload.encrypt(
              targetEmail,
              `${PAYLOAD_PURPOSE}:recipient`,
            ),
            recipientMobileEncrypted: null,
            messageBodyEncrypted:
              this.notificationPayload.encryptMessage(message),
            providerIdempotencyKey: `secretary-invitation:${invitation.id}:retarget:${this.sha256(`${target.id}:${token}`).slice(0, 16)}`,
            attemptCount: 0,
            processingStartedAt: null,
            leaseExpiresAt: null,
            processingWorkerId: null,
            nextAttemptAt: now,
            sentAt: null,
            failedAt: null,
            cancelledAt: null,
            protectedPayloadPurgedAt: null,
          },
        });

        return retargeted;
      });

      return {
        invitationId: updated.id,
        status: updated.status,
        updatedAt: updated.updatedAt,
      };
    }

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
    const invitation = await this.prisma.secretaryInvitation.findFirst({
      where: {
        id: invitationId,
        status: SecretaryInvitationStatus.PENDING,
        practiceLocation: { doctorProfile: { userId: actorUserId } },
      },
      select: { id: true },
    });
    if (!invitation) {
      throw new NotFoundException('Pending invitation was not found.');
    }

    const now = new Date();
    const removed = await this.prisma.$transaction(async (transaction) => {
      const result = await transaction.secretaryInvitation.updateMany({
        where: {
          id: invitation.id,
          status: SecretaryInvitationStatus.PENDING,
        },
        data: {
          status: SecretaryInvitationStatus.REVOKED,
          revokedAt: now,
          activeInvitationKey: null,
        },
      });
      if (result.count !== 1) return false;
      await transaction.notificationOutbox.updateMany({
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

    if (!removed) {
      throw new ConflictException(
        'This invitation is no longer pending and cannot be cancelled.',
      );
    }
    return { invitationId, removed: true };
  }

  async accept(authenticatedUserId: string, token: string) {
    if (!token) {
      throw new BadRequestException('Invalid or expired Secretary invitation.');
    }
    return this.acceptSelected(authenticatedUserId, {
      tokenHash: this.sha256(token),
    });
  }

  async acceptPendingById(authenticatedUserId: string, invitationId: string) {
    if (!invitationId) {
      throw new BadRequestException('Secretary invitation is required.');
    }
    return this.acceptSelected(authenticatedUserId, { invitationId });
  }

  private async acceptSelected(
    authenticatedUserId: string,
    selector: { tokenHash: string } | { invitationId: string },
  ) {
    const tokenHash = 'tokenHash' in selector ? selector.tokenHash : null;

    const outcome = await this.prisma.$transaction(async (transaction) => {
      const locked = await transaction.$queryRaw<Array<{ id: string }>>(
        'tokenHash' in selector
          ? Prisma.sql`SELECT "id" FROM "SecretaryInvitation" WHERE "tokenHash" = ${selector.tokenHash} LIMIT 1 FOR UPDATE`
          : Prisma.sql`SELECT "id" FROM "SecretaryInvitation" WHERE "id" = ${selector.invitationId} LIMIT 1 FOR UPDATE`,
      );
      if (!locked[0]) return { kind: 'invalid' as const };

      const invitation = await transaction.secretaryInvitation.findUnique({
        where: { id: locked[0].id },
        include: { notificationOutbox: true },
      });
      if (invitation?.status === SecretaryInvitationStatus.REVOKED) {
        return { kind: 'cancelled' as const };
      }
      if (
        !invitation ||
        invitation.status !== SecretaryInvitationStatus.PENDING ||
        (tokenHash !== null && invitation.tokenHash !== tokenHash) ||
        !invitation.activeInvitationKey ||
        !invitation.requestedAssignmentType
      ) {
        return { kind: 'invalid' as const };
      }

      const now = new Date();
      if (invitation.expiresAt <= now) {
        await transaction.secretaryInvitation.update({
          where: { id: invitation.id },
          data: {
            status: SecretaryInvitationStatus.EXPIRED,
            tokenHash: null,
            activeInvitationKey: null,
          },
        });
        return { kind: 'invalid' as const };
      }

      const user = await transaction.user.findUnique({
        where: { id: authenticatedUserId },
        select: {
          id: true,
          email: true,
          mobileNumber: true,
          mobileNumberHash: true,
          loginIdentifierType: true,
          role: true,
          accountStatus: true,
          administrativeRestrictionStatus: true,
          emailVerifiedAt: true,
          mobileVerifiedAt: true,
        },
      });
      if (!user || user.role !== UserRole.SECRETARY) {
        return { kind: 'role' as const };
      }
      if (
        user.accountStatus !== UserAccountStatus.ACTIVE ||
        user.administrativeRestrictionStatus !==
          AdministrativeRestrictionStatus.NONE ||
        !accountIdentifierIsVerified(user)
      ) {
        return { kind: 'ineligible' as const };
      }

      if (invitation.targetUserId) {
        if (invitation.targetUserId !== user.id) {
          return { kind: 'identity' as const };
        }
      } else if (
        invitation.identifierType === AccountLoginIdentifierType.EMAIL
      ) {
        if (
          !user.email ||
          user.email.trim().toLowerCase() !== invitation.normalizedIdentifier
        ) {
          return { kind: 'identity' as const };
        }
      } else if (
        !user.mobileNumber ||
        user.mobileNumber !== invitation.normalizedIdentifier
      ) {
        return { kind: 'identity' as const };
      }

      const locations = await transaction.$queryRaw<
        Array<{
          id: string;
          doctorUserId: string;
          currentRegularPracticeStaffId: string | null;
        }>
      >(
        Prisma.sql`SELECT pl."id", dp."userId" AS "doctorUserId", pl."currentRegularPracticeStaffId" FROM "PracticeLocation" pl INNER JOIN "DoctorProfile" dp ON dp."id" = pl."doctorProfileId" WHERE pl."id" = ${invitation.practiceLocationId} LIMIT 1 FOR UPDATE OF pl`,
      );
      const location = locations[0];
      if (!location || location.doctorUserId !== invitation.invitedByUserId) {
        return { kind: 'ownership' as const };
      }
      if (
        invitation.requestedAssignmentType ===
          SecretaryInvitationAssignmentType.CLINIC_SECRETARY &&
        location.currentRegularPracticeStaffId !==
          invitation.expectedCurrentPracticeStaffId
      ) {
        return { kind: 'replacement_changed' as const };
      }
      if (
        invitation.requestedAssignmentType ===
          SecretaryInvitationAssignmentType.CLINIC_SECRETARY &&
        !invitation.requestedAuthorityBundles.length
      ) {
        return { kind: 'invalid_plan' as const };
      }
      if (
        invitation.requestedAssignmentType ===
          SecretaryInvitationAssignmentType.SUBSTITUTE_SECRETARY &&
        (!invitation.requestedCoverageMode ||
          !invitation.requestedFromServiceDate ||
          !invitation.requestedToServiceDate)
      ) {
        return { kind: 'invalid_plan' as const };
      }

      const assignment = await this.prepareAssignment(
        transaction,
        user.id,
        location.id,
        now,
      );
      let coverageId: string | null = null;

      if (
        invitation.requestedAssignmentType ===
        SecretaryInvitationAssignmentType.CLINIC_SECRETARY
      ) {
        await this.applyClinicPlan(
          transaction,
          assignment.id,
          invitation.invitedByUserId,
          invitation.requestedAuthorityBundles,
          invitation.requestedCancelClinicDay,
          now,
        );
        await transaction.practiceLocation.update({
          where: { id: location.id },
          data: { currentRegularPracticeStaffId: assignment.id },
        });
        if (
          invitation.expectedCurrentPracticeStaffId &&
          invitation.expectedCurrentPracticeStaffId !== assignment.id
        ) {
          await this.disableOutgoing(
            transaction,
            invitation.expectedCurrentPracticeStaffId,
            invitation.invitedByUserId,
            location.id,
            now,
          );
        }
      } else {
        if (location.currentRegularPracticeStaffId === assignment.id) {
          throw new ConflictException(
            'The current Clinic Secretary cannot also accept Substitute Secretary coverage for this clinic.',
          );
        }
        const coverageMode = invitation.requestedCoverageMode;
        const fromServiceDate = invitation.requestedFromServiceDate;
        const toServiceDate = invitation.requestedToServiceDate;
        if (!coverageMode || !fromServiceDate || !toServiceDate) {
          throw new ConflictException('Invitation coverage plan is invalid.');
        }
        coverageId = await this.createCoverage(
          transaction,
          assignment.id,
          location.id,
          invitation.invitedByUserId,
          coverageMode,
          fromServiceDate,
          toServiceDate,
          now,
        );
      }

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
      if (
        invitation.notificationOutbox?.status ===
        NotificationOutboxStatus.PENDING
      ) {
        await transaction.notificationOutbox.update({
          where: { id: invitation.notificationOutbox.id },
          data: {
            status: NotificationOutboxStatus.CANCELLED,
            cancelledAt: now,
          },
        });
      }

      return {
        kind: 'accepted' as const,
        assignmentType: invitation.requestedAssignmentType,
        practiceStaffId: assignment.id,
        coverageId,
      };
    });

    if (outcome.kind === 'accepted') {
      return {
        accepted: true,
        assignmentType: outcome.assignmentType,
        practiceStaffId: outcome.practiceStaffId,
        coverageId: outcome.coverageId,
      };
    }
    if (outcome.kind === 'role') {
      throw new ForbiddenException(
        'Only a signed-in Secretary may accept this invitation.',
      );
    }
    if (outcome.kind === 'ineligible') {
      throw new ForbiddenException(
        'Your Secretary account must be active and its registered mobile number or email address must be verified before accepting.',
      );
    }
    if (outcome.kind === 'identity') {
      throw new ForbiddenException(
        'This invitation belongs to a different Secretary account.',
      );
    }
    if (outcome.kind === 'replacement_changed') {
      throw new ConflictException(
        'The current Clinic Secretary changed after this invitation was sent. Ask the Doctor to review and send a new invitation.',
      );
    }
    if (outcome.kind === 'ownership') {
      throw new ConflictException(
        'The clinic ownership for this invitation is no longer valid.',
      );
    }
    if (outcome.kind === 'invalid_plan') {
      throw new ConflictException(
        'This invitation has no valid assignment plan. Ask the Doctor to send a new invitation.',
      );
    }
    if (outcome.kind === 'cancelled') {
      throw new ConflictException(
        'This invitation was cancelled by the Doctor and can no longer be accepted.',
      );
    }
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
      if (!authorityBundles.length) {
        throw new BadRequestException(
          'At least one Clinic Secretary authority bundle is required.',
        );
      }
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
    ) {
      throw new BadRequestException(
        'A valid assignment type and role-specific configuration are required.',
      );
    }

    const from = this.parseDate(dto.fromServiceDate);
    const to = this.parseDate(dto.toServiceDate);
    if (from > to) {
      throw new BadRequestException(
        'Substitute Secretary coverage start date must not be after the end date.',
      );
    }
    if (
      dto.coverageMode === DtoCoverageMode.ONE_SERVICE_DATE &&
      dto.fromServiceDate !== dto.toServiceDate
    ) {
      throw new BadRequestException(
        'One Clinic Day coverage must use the same Service Date.',
      );
    }

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
    transaction: Tx,
    userId: string,
    practiceLocationId: string,
    now: Date,
  ) {
    const rows = await transaction.$queryRaw<
      Array<{ id: string; staffRole: string; isActive: boolean }>
    >(
      Prisma.sql`SELECT "id", "staffRole", "isActive" FROM "PracticeStaff" WHERE "userId" = ${userId} AND "practiceLocationId" = ${practiceLocationId} LIMIT 1 FOR UPDATE`,
    );
    const existing = rows[0];
    if (existing && existing.staffRole !== 'SECRETARY') {
      throw new ConflictException(
        'Existing practice staff role is incompatible.',
      );
    }
    if (existing) {
      if (!existing.isActive) {
        await transaction.practiceStaff.update({
          where: { id: existing.id },
          data: {
            isActive: true,
            activatedAt: now,
            deactivatedAt: null,
            disconnectedAt: null,
          },
        });
      }
      return { id: existing.id };
    }
    return transaction.practiceStaff.create({
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
    transaction: Tx,
    practiceStaffId: string,
    actorUserId: string,
    bundles: string[],
    cancel: boolean,
    now: Date,
  ) {
    await transaction.practiceStaffAuthorityBundle.updateMany({
      where: { practiceStaffId, status: 'ACTIVE' },
      data: {
        status: 'REVOKED',
        revokedByUserId: actorUserId,
        revokedAt: now,
      },
    });
    for (const bundle of bundles) {
      await transaction.$executeRaw(
        Prisma.sql`INSERT INTO "PracticeStaffAuthorityBundle" ("id", "practiceStaffId", "bundleType", "status", "grantedByUserId", "grantedAt", "createdAt") VALUES (${randomUUID()}, ${practiceStaffId}, CAST(${bundle} AS "PracticeStaffAuthorityBundleType"), 'ACTIVE', ${actorUserId}, ${now}, ${now})`,
      );
    }

    await transaction.practiceStaffCapability.updateMany({
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
    if (cancel) {
      await transaction.practiceStaffCapability.create({
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
  }

  private async disableOutgoing(
    transaction: Tx,
    practiceStaffId: string,
    actorUserId: string,
    practiceLocationId: string,
    now: Date,
  ) {
    const days = await transaction.clinicDay.findMany({
      where: {
        practiceLocationId,
        operatingPracticeStaffId: practiceStaffId,
        status: { in: ['NOT_STARTED', 'DELAYED', 'STARTED'] },
      },
      select: { id: true, serviceDate: true },
    });
    for (const day of days) {
      await transaction.clinicDay.update({
        where: { id: day.id },
        data: { operatingPracticeStaffId: null },
      });
      await transaction.clinicDayOperatingStaffAudit.create({
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
    await transaction.practiceStaffCapability.updateMany({
      where: { practiceStaffId, status: 'ACTIVE' },
      data: {
        status: 'REVOKED',
        activeCapabilityKey: null,
        revokedByUserId: actorUserId,
        revokedAt: now,
      },
    });
    await transaction.practiceStaffAuthorityBundle.updateMany({
      where: { practiceStaffId, status: 'ACTIVE' },
      data: {
        status: 'REVOKED',
        revokedByUserId: actorUserId,
        revokedAt: now,
      },
    });
    await transaction.practiceStaff.update({
      where: { id: practiceStaffId },
      data: { isActive: false, deactivatedAt: now },
    });
  }

  private async createCoverage(
    transaction: Tx,
    practiceStaffId: string,
    practiceLocationId: string,
    actorUserId: string,
    mode: SubstituteSecretaryCoverageMode,
    from: Date,
    to: Date,
    now: Date,
  ) {
    await transaction.$executeRaw(
      Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`SUBSTITUTE_COVERAGE|${practiceLocationId}`}, 0))`,
    );
    if (
      await transaction.substituteSecretaryCoverageDate.findFirst({
        where: {
          practiceLocationId,
          status: 'ACTIVE',
          serviceDate: { gte: from, lte: to },
        },
        select: { id: true },
      })
    ) {
      throw new ConflictException(
        'Another active Substitute Secretary coverage already applies to one or more selected Service Dates.',
      );
    }

    const coverage = await transaction.substituteSecretaryCoverage.create({
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
    ) {
      await transaction.substituteSecretaryCoverageDate.create({
        data: {
          coverageId: coverage.id,
          practiceLocationId,
          serviceDate: new Date(cursor),
          status: 'ACTIVE',
          createdAt: now,
        },
      });
    }
    return coverage.id;
  }

  private parseDate(value: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      throw new BadRequestException('Service Date must use YYYY-MM-DD.');
    }
    const date = new Date(`${value}T00:00:00.000Z`);
    if (
      Number.isNaN(date.getTime()) ||
      date.toISOString().slice(0, 10) !== value
    ) {
      throw new BadRequestException(
        'Service Date is not a valid calendar date.',
      );
    }
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
