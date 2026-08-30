import {
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
import { PrismaService } from '../prisma/prisma.service';
import { CreateSecretaryInvitationDto } from './dto/create-secretary-invitation.dto';

const INVITATION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
const PAYLOAD_PURPOSE = 'secretary-invitation';

@Injectable()
export class SecretaryInvitationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly payload: ProtectedAccountPayloadService,
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

  private publicAppBaseUrl() {
    return (
      this.config.get<string>('PUBLIC_APP_BASE_URL') ?? 'http://localhost:5173'
    ).replace(/\/$/, '');
  }
  private sha256(value: string) {
    return createHash('sha256').update(value, 'utf8').digest('hex');
  }
}
