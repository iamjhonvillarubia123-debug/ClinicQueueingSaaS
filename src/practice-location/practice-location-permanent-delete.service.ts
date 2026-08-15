import { createHash } from 'crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  AdministrativeRestrictionStatus,
  AppointmentStatus,
  ClinicDayOperatingStaffChangeType,
  ClinicDayStatus,
  CommandType,
  NotificationOutboxStatus,
  PracticeLocationLifecycleStatus,
  PracticeStaffCapabilityStatus,
  Prisma,
  ScheduledReminderStatus,
  UserAccountStatus,
  UserRole,
} from '../../generated/prisma/client';
import { PasswordSecurityService } from '../auth/security/password-security.service';
import { PrismaService } from '../prisma/prisma.service';
import { PermanentlyDeletePracticeLocationDto } from './dto/permanently-delete-practice-location.dto';

const IDEMPOTENCY_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

type TransactionClient = Prisma.TransactionClient;

type LockedPracticeLocation = {
  id: string;
  lifecycleStatus: PracticeLocationLifecycleStatus;
  doctorUserId: string;
  timeZone: string | null;
};

type OperatingClinicDay = {
  id: string;
  practiceLocationId: string;
  serviceDate: Date;
  operatingPracticeStaffId: string;
};

@Injectable()
export class PracticeLocationPermanentDeleteService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwordSecurityService: PasswordSecurityService,
  ) {}

  async permanentlyDelete(
    authenticatedUserId: string,
    dto: PermanentlyDeletePracticeLocationDto,
    idempotencyKey: string,
  ) {
    if (!dto.confirmPermanentDelete) {
      throw new BadRequestException(
        'Practice location permanent delete must be explicitly confirmed.',
      );
    }

    const key = this.normalizeIdempotencyKey(idempotencyKey);
    const commandType = CommandType.PRACTICE_LOCATION_DELETE;
    const commandIdentityKey = this.hash(
      `${commandType}|${authenticatedUserId}|${dto.practiceLocationId}|${key}`,
    );
    const requestFingerprint = this.hash(
      `${commandType}|${authenticatedUserId}|${dto.practiceLocationId}|confirmed`,
    );

    return this.prisma.$transaction(async (transaction) => {
      await this.acquireCommandLock(transaction, commandIdentityKey);
      const location = await this.lockPracticeLocation(
        transaction,
        dto.practiceLocationId,
      );
      await this.lockUser(transaction, authenticatedUserId);

      const actor = await transaction.user.findUnique({
        where: { id: authenticatedUserId },
        select: {
          role: true,
          accountStatus: true,
          administrativeRestrictionStatus: true,
          passwordHash: true,
        },
      });
      this.assertOwningDoctor(actor, authenticatedUserId, location);

      const replay = await transaction.commandIdempotency.findUnique({
        where: { commandIdentityKey },
      });
      if (replay) {
        this.assertCompatibleReplay(
          replay.requestFingerprint,
          requestFingerprint,
        );
        return { permanentlyDeleted: true, replayed: true };
      }

      if (
        location.lifecycleStatus ===
        PracticeLocationLifecycleStatus.PERMANENTLY_DELETED
      ) {
        throw new ConflictException(
          'Practice location is already permanently deleted.',
        );
      }

      if (
        !actor?.passwordHash ||
        !(await this.passwordSecurityService.verify(
          dto.password,
          actor.passwordHash,
        ))
      ) {
        throw new UnauthorizedException('Current password is invalid.');
      }

      await this.assertNoStartedClinicDay(transaction, location.id);
      await this.assertNoUnresolvedFutureAppointments(transaction, location);
      await this.assertReminderDeliveryCanBeStopped(transaction, location.id);

      const now = new Date();
      await this.clearNonTerminalOperatingStaff(
        transaction,
        location.id,
        authenticatedUserId,
        now,
      );

      const staffIds = await this.lockActiveStaff(transaction, location.id);
      await this.revokeOperationalCapabilities(
        transaction,
        staffIds,
        authenticatedUserId,
        now,
      );
      await this.cancelScheduledReminders(transaction, location.id, now);

      await transaction.practiceLocation.update({
        where: { id: location.id },
        data: {
          lifecycleStatus: PracticeLocationLifecycleStatus.PERMANENTLY_DELETED,
          currentRegularPracticeStaffId: null,
          isBookingEnabled: false,
        },
      });

      if (staffIds.length > 0) {
        await transaction.practiceStaff.updateMany({
          where: { id: { in: staffIds }, isActive: true },
          data: { isActive: false },
        });
      }

      await transaction.commandIdempotency.create({
        data: {
          idempotencyKey: key,
          commandIdentityKey,
          commandType,
          requestFingerprint,
          practiceLocationId: location.id,
          actorUserId: authenticatedUserId,
          completedAt: now,
          expiresAt: new Date(now.getTime() + IDEMPOTENCY_RETENTION_MS),
          createdAt: now,
        },
      });

      return { permanentlyDeleted: true, replayed: false };
    });
  }

  private async lockPracticeLocation(
    transaction: TransactionClient,
    practiceLocationId: string,
  ): Promise<LockedPracticeLocation> {
    const rows = await transaction.$queryRaw<LockedPracticeLocation[]>(Prisma.sql`
      SELECT
        pl."id",
        pl."lifecycleStatus",
        pl."timeZone",
        dp."userId" AS "doctorUserId"
      FROM "PracticeLocation" pl
      INNER JOIN "DoctorProfile" dp ON dp."id" = pl."doctorProfileId"
      WHERE pl."id" = ${practiceLocationId}
      LIMIT 1
      FOR UPDATE OF pl
    `);
    const location = rows[0];
    if (!location) {
      throw new NotFoundException('Practice location was not found.');
    }
    return location;
  }

  private assertOwningDoctor(
    actor: {
      role: UserRole;
      accountStatus: UserAccountStatus;
      administrativeRestrictionStatus: AdministrativeRestrictionStatus;
      passwordHash: string;
    } | null,
    authenticatedUserId: string,
    location: LockedPracticeLocation,
  ): void {
    if (
      !actor ||
      actor.role !== UserRole.DOCTOR ||
      actor.accountStatus !== UserAccountStatus.ACTIVE ||
      actor.administrativeRestrictionStatus !==
        AdministrativeRestrictionStatus.NONE ||
      location.doctorUserId !== authenticatedUserId
    ) {
      throw new ForbiddenException(
        'Only the eligible owning doctor may permanently delete this practice location.',
      );
    }
  }

  private async assertNoStartedClinicDay(
    transaction: TransactionClient,
    practiceLocationId: string,
  ): Promise<void> {
    const started = await transaction.clinicDay.findFirst({
      where: {
        practiceLocationId,
        status: ClinicDayStatus.STARTED,
      },
      select: { id: true },
    });
    if (started) {
      throw new ConflictException(
        'Close or cancel the started clinic day before permanently deleting the practice location.',
      );
    }
  }

  private async assertNoUnresolvedFutureAppointments(
    transaction: TransactionClient,
    location: LockedPracticeLocation,
  ): Promise<void> {
    const blockingStatuses = [
      AppointmentStatus.WAITING,
      AppointmentStatus.CALLED,
      AppointmentStatus.TEMPORARILY_ABSENT,
      AppointmentStatus.OUT_FOR_PROCEDURE,
    ];
    const rows = await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT a."id"
      FROM "Appointment" a
      WHERE a."practiceLocationId" = ${location.id}
        AND a."serviceDate" >= (
          CURRENT_TIMESTAMP AT TIME ZONE COALESCE(${location.timeZone}, 'UTC')
        )::date
        AND a."status" IN (${Prisma.join(blockingStatuses)})
      ORDER BY a."serviceDate", a."id"
      LIMIT 1
      FOR UPDATE
    `);
    if (rows[0]) {
      throw new ConflictException(
        'Resolve or cancel future confirmed appointments before permanently deleting the practice location.',
      );
    }
  }

  private async assertReminderDeliveryCanBeStopped(
    transaction: TransactionClient,
    practiceLocationId: string,
  ): Promise<void> {
    const processingReminder = await transaction.scheduledReminder.findFirst({
      where: {
        practiceLocationId,
        status: ScheduledReminderStatus.PROCESSING,
      },
      select: { id: true },
    });
    if (processingReminder) {
      throw new ConflictException(
        'A reminder is already processing. Resolve its delivery state before permanently deleting the practice location.',
      );
    }

    const processingOutbox = await transaction.notificationOutbox.findFirst({
      where: {
        practiceLocationId,
        scheduledReminderId: { not: null },
        status: NotificationOutboxStatus.PROCESSING,
      },
      select: { id: true },
    });
    if (processingOutbox) {
      throw new ConflictException(
        'A reminder delivery is already processing. Resolve its delivery state before permanently deleting the practice location.',
      );
    }
  }

  private async clearNonTerminalOperatingStaff(
    transaction: TransactionClient,
    practiceLocationId: string,
    actorUserId: string,
    now: Date,
  ): Promise<void> {
    const clinicDays = await transaction.$queryRaw<OperatingClinicDay[]>(Prisma.sql`
      SELECT
        "id",
        "practiceLocationId",
        "serviceDate",
        "operatingPracticeStaffId"
      FROM "ClinicDay"
      WHERE "practiceLocationId" = ${practiceLocationId}
        AND "operatingPracticeStaffId" IS NOT NULL
        AND "status" IN ('NOT_STARTED'::"ClinicDayStatus", 'DELAYED'::"ClinicDayStatus")
      ORDER BY "id"
      FOR UPDATE
    `);

    for (const clinicDay of clinicDays) {
      await transaction.clinicDayOperatingStaffAudit.create({
        data: {
          clinicDayId: clinicDay.id,
          practiceLocationId: clinicDay.practiceLocationId,
          serviceDate: clinicDay.serviceDate,
          changeType: ClinicDayOperatingStaffChangeType.CLEARED,
          previousOperatingPracticeStaffId: clinicDay.operatingPracticeStaffId,
          newOperatingPracticeStaffId: null,
          actorUserId,
          createdAt: now,
        },
      });
      await transaction.clinicDay.update({
        where: { id: clinicDay.id },
        data: { operatingPracticeStaffId: null },
      });
    }
  }

  private async lockActiveStaff(
    transaction: TransactionClient,
    practiceLocationId: string,
  ): Promise<string[]> {
    const rows = await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id"
      FROM "PracticeStaff"
      WHERE "practiceLocationId" = ${practiceLocationId}
        AND "isActive" = TRUE
      ORDER BY "id"
      FOR UPDATE
    `);
    return rows.map((row) => row.id);
  }

  private async revokeOperationalCapabilities(
    transaction: TransactionClient,
    staffIds: string[],
    actorUserId: string,
    now: Date,
  ): Promise<void> {
    if (staffIds.length === 0) {
      return;
    }
    await transaction.practiceStaffCapability.updateMany({
      where: {
        practiceStaffId: { in: staffIds },
        status: PracticeStaffCapabilityStatus.ACTIVE,
      },
      data: {
        status: PracticeStaffCapabilityStatus.REVOKED,
        activeCapabilityKey: null,
        revokedByUserId: actorUserId,
        revokedAt: now,
      },
    });
  }

  private async cancelScheduledReminders(
    transaction: TransactionClient,
    practiceLocationId: string,
    now: Date,
  ): Promise<void> {
    const scheduled = await transaction.scheduledReminder.findMany({
      where: {
        practiceLocationId,
        status: ScheduledReminderStatus.SCHEDULED,
      },
      select: { id: true },
    });
    const reminderIds = scheduled.map((reminder) => reminder.id);
    if (reminderIds.length === 0) {
      return;
    }

    await transaction.notificationOutbox.updateMany({
      where: {
        scheduledReminderId: { in: reminderIds },
        status: NotificationOutboxStatus.PENDING,
      },
      data: { status: NotificationOutboxStatus.CANCELLED },
    });
    await transaction.scheduledReminder.updateMany({
      where: { id: { in: reminderIds } },
      data: {
        status: ScheduledReminderStatus.CANCELLED,
        cancelledAt: now,
      },
    });
  }

  private async acquireCommandLock(
    transaction: TransactionClient,
    commandIdentityKey: string,
  ): Promise<void> {
    await transaction.$executeRaw(Prisma.sql`
      SELECT pg_advisory_xact_lock(hashtextextended(${commandIdentityKey}, 0))
    `);
  }

  private async lockUser(
    transaction: TransactionClient,
    userId: string,
  ): Promise<void> {
    await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id"
      FROM "User"
      WHERE "id" = ${userId}
      LIMIT 1
      FOR UPDATE
    `);
  }

  private normalizeIdempotencyKey(value: string): string {
    const normalized = value?.trim();
    if (!normalized) {
      throw new BadRequestException('Idempotency-Key header is required.');
    }
    if (normalized.length > 100) {
      throw new BadRequestException('Idempotency-Key is too long.');
    }
    return normalized;
  }

  private assertCompatibleReplay(
    storedFingerprint: string,
    requestFingerprint: string,
  ): void {
    if (storedFingerprint !== requestFingerprint) {
      throw new ConflictException(
        'Idempotency-Key was already used for a different request.',
      );
    }
  }

  private hash(value: string): string {
    return createHash('sha256').update(value, 'utf8').digest('hex');
  }
}
