import { createHash } from 'crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PasswordSecurityService } from '../auth/security/password-security.service';
import type { AuthenticatedUserContext } from '../auth/types/authenticated-request';

@Injectable()
export class AccountAnnouncementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordSecurityService,
  ) {}
  async publish(
    actor: AuthenticatedUserContext,
    recipientIds: string[],
    title: string,
    message: string,
    password: string,
    key: string,
  ) {
    if (!key?.trim() || key.length > 100)
      throw new BadRequestException('A valid Idempotency-Key is required.');
    if (actor.role !== 'SYSTEM_ADMIN')
      throw new ForbiddenException(
        'System administrator authority is required.',
      );
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${actor.userId} FOR UPDATE`;
      const admin = await tx.user.findUnique({
        where: { id: actor.userId },
        select: {
          role: true,
          accountStatus: true,
          administrativeRestrictionStatus: true,
          passwordHash: true,
        },
      });
      if (
        !admin ||
        admin.role !== 'SYSTEM_ADMIN' ||
        admin.accountStatus !== 'ACTIVE' ||
        admin.administrativeRestrictionStatus !== 'NONE'
      )
        throw new ForbiddenException(
          'Active administrator authority is required.',
        );
      if (
        !password ||
        !(await this.passwords.verify(password, admin.passwordHash))
      )
        throw new UnauthorizedException('Current password is incorrect.');
      const now = new Date();
      const session = await tx.userSession.findFirst({
        where: {
          id: actor.sessionId,
          userId: actor.userId,
          revokedAt: null,
          expiresAt: { gt: now },
          idleExpiresAt: { gt: now },
        },
        select: { id: true },
      });
      if (!session) throw new UnauthorizedException('Authentication required.');
      const targets = await tx.user.findMany({
        where: {
          id: { in: recipientIds },
          role: { in: ['DOCTOR', 'SECRETARY'] },
          accountStatus: { not: 'PERMANENTLY_CLOSED' },
        },
        select: { id: true },
      });
      if (
        targets.length !== recipientIds.length ||
        !targets.length ||
        targets.length > 100 ||
        !title.trim() ||
        !message.trim()
      )
        throw new BadRequestException(
          'Select current account recipients and a nonempty message.',
        );
      // Actor lock serializes same-admin retries; changed payloads cannot reuse a key.
      const identity = createHash('sha256')
        .update(`announcement:${actor.userId}:${key.trim()}`)
        .digest('hex');
      const payload = JSON.stringify([
        recipientIds.slice().sort(),
        title.trim(),
        message.trim(),
      ]);
      const fingerprint = createHash('sha256').update(payload).digest('hex');
      const prior = await tx.applicationNotification.findMany({
        where: {
          sourceActorUserId: actor.userId,
          notificationIdentityKey: {
            in: targets.map((target) =>
              createHash('sha256')
                .update(identity + target.id)
                .digest('hex'),
            ),
          },
        },
        select: { title: true, message: true },
      });
      if (
        prior.length &&
        (prior.length !== targets.length ||
          prior.some(
            (item) =>
              item.title !== title.trim() || item.message !== message.trim(),
          ))
      )
        throw new ConflictException(
          'This announcement key was already used with different content.',
        );
      // Fingerprint is retained in a first recipient-independent marker via an internal source value.
      const marker = await tx.applicationNotification.findUnique({
        where: { notificationIdentityKey: identity },
        select: { message: true },
      });
      if (marker && marker.message !== fingerprint)
        throw new ConflictException(
          'This announcement key was already used with different recipients or content.',
        );
      if (marker) return { published: targets.length, replayed: true };
      await tx.applicationNotification.create({
        data: {
          recipientUserId: actor.userId,
          notificationType: 'ACCOUNT_ACTIVITY',
          title: 'Announcement publication receipt',
          message: fingerprint,
          sourceActorUserId: actor.userId,
          notificationIdentityKey: identity,
          readAt: now,
        },
      });
      await tx.applicationNotification.createMany({
        data: targets.map((target) => ({
          recipientUserId: target.id,
          notificationType: 'ACCOUNT_ACTIVITY' as const,
          title: title.trim(),
          message: message.trim(),
          sourceActorUserId: actor.userId,
          notificationIdentityKey: createHash('sha256')
            .update(identity + target.id)
            .digest('hex'),
        })),
      });
      return { published: targets.length, replayed: false };
    });
  }
}
