import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'crypto';
import {
  NotificationChannel,
  NotificationOutboxStatus,
  NotificationType,
  SecretaryInvitationStatus,
} from '../../generated/prisma/client';
import { ProtectedAccountPayloadService } from '../auth/security/protected-account-payload.service';
import { PasswordSecurityService } from '../auth/security/password-security.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSecretaryInvitationDto } from './dto/create-secretary-invitation.dto';

const INVITATION_LIFETIME_MS = 72 * 60 * 60 * 1000;
const PAYLOAD_PURPOSE = 'secretary-invitation';

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
    const location = await this.prisma.practiceLocation.findFirst({
      where: {
        id: dto.practiceLocationId,
        doctorProfile: { userId: actorUserId },
      },
      select: { id: true, name: true },
    });
    if (!location)
      throw new NotFoundException('Practice location was not found.');
    const existingUser = await this.prisma.user.findFirst({
      where: { email: normalizedEmail },
      select: { id: true },
    });
    if (existingUser)
      throw new ConflictException(
        'This email already has an account. Assign the existing Secretary instead.',
      );
    const activeInvitationKey = this.sha256(
      `${location.id}:${normalizedEmail}`,
    );
    const existing = await this.prisma.secretaryInvitation.findUnique({
      where: { activeInvitationKey },
      select: { id: true },
    });
    if (existing)
      throw new ConflictException(
        'A pending invitation already exists for this email at this clinic.',
      );
    const token = randomBytes(32).toString('base64url');
    const tokenHash = this.sha256(token);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + INVITATION_LIFETIME_MS);
    const invitation = await this.prisma.$transaction(async (transaction) => {
      const created = await transaction.secretaryInvitation.create({
        data: {
          practiceLocationId: location.id,
          invitedByUserId: actorUserId,
          normalizedEmail,
          firstName: dto.firstName.trim(),
          lastName: dto.lastName.trim(),
          mobileNumber: dto.mobileNumber.trim(),
          tokenHash,
          activeInvitationKey,
          status: SecretaryInvitationStatus.PENDING,
          expiresAt,
          createdAt: now,
        },
      });
      const invitationUrl = `${this.publicAppBaseUrl()}/secretary-invitations/accept?token=${encodeURIComponent(token)}`;
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
            `You have been invited to join ${location.name} as a Secretary. Complete your account: ${invitationUrl}`,
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
    const invitation = await this.prisma.secretaryInvitation.findFirst({
      where: {
        tokenHash: this.sha256(token),
        status: SecretaryInvitationStatus.PENDING,
      },
      select: {
        firstName: true,
        lastName: true,
        normalizedEmail: true,
        expiresAt: true,
        practiceLocation: { select: { name: true } },
      },
    });
    if (!invitation || invitation.expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException('Invalid or expired Secretary invitation.');
    }
    return {
      name: `${invitation.firstName} ${invitation.lastName}`.trim(),
      email: invitation.normalizedEmail,
      clinicName: invitation.practiceLocation.name,
      expiresAt: invitation.expiresAt,
    };
  }

  async accept(token: string, password: string) {
    const tokenHash = this.sha256(token);
    const passwordHash = await this.passwords.hash(password);
    const outcome = await this.prisma.$transaction(async (transaction) => {
      const rows = await transaction.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "SecretaryInvitation"
        WHERE "tokenHash" = ${tokenHash}
        LIMIT 1 FOR UPDATE
      `;
      if (!rows[0]) return 'invalid' as const;
      const invitation = await transaction.secretaryInvitation.findUnique({
        where: { id: rows[0].id },
        include: { notificationOutbox: true },
      });
      if (
        !invitation ||
        invitation.status !== SecretaryInvitationStatus.PENDING ||
        invitation.tokenHash !== tokenHash ||
        !invitation.activeInvitationKey
      )
        return 'invalid' as const;
      const now = new Date();
      if (invitation.expiresAt.getTime() <= now.getTime()) {
        await transaction.secretaryInvitation.update({
          where: { id: invitation.id },
          data: {
            status: SecretaryInvitationStatus.EXPIRED,
            tokenHash: null,
            activeInvitationKey: null,
          },
        });
        return 'expired' as const;
      }
      const existing = await transaction.user.findFirst({
        where: { email: invitation.normalizedEmail },
        select: { id: true },
      });
      if (existing) return 'existing' as const;
      const user = await transaction.user.create({
        data: {
          email: invitation.normalizedEmail,
          firstName: invitation.firstName,
          lastName: invitation.lastName,
          mobileNumber: invitation.mobileNumber,
          passwordHash,
          role: 'SECRETARY',
          accountStatus: 'ACTIVE',
          emailVerifiedAt: now,
        },
      });
      await transaction.practiceStaff.create({
        data: {
          userId: user.id,
          practiceLocationId: invitation.practiceLocationId,
          staffRole: 'SECRETARY',
          isActive: true,
          activatedAt: now,
        },
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
      return 'accepted' as const;
    });
    if (outcome !== 'accepted') {
      throw new BadRequestException(
        outcome === 'existing'
          ? 'An account already exists for this email. Sign in instead.'
          : 'Invalid or expired Secretary invitation.',
      );
    }
    return { accepted: true };
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
