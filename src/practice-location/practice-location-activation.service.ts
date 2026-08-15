import { createHash } from 'crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AdministrativeRestrictionStatus,
  CommandType,
  PracticeLocationLifecycleStatus,
  Prisma,
  UserAccountStatus,
  UserRole,
  Weekday,
} from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CrossLocationScheduleConflictService } from '../schedule/cross-location-schedule-conflict.service';
import { DoctorCalendarAvailabilityService } from '../schedule/doctor-calendar-availability.service';
import { ScheduleResolutionService } from '../schedule/schedule-resolution.service';
import { ScheduleTimeService } from '../schedule/schedule-time.service';
import { ActivatePracticeLocationDto } from './dto/activate-practice-location.dto';
import { ReactivatePracticeLocationDto } from './dto/reactivate-practice-location.dto';

const IDEMPOTENCY_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

type TransactionClient = Prisma.TransactionClient;

type LockedPracticeLocation = {
  id: string;
  doctorProfileId: string;
  doctorUserId: string;
  lifecycleStatus: PracticeLocationLifecycleStatus;
  name: string | null;
  addressLine1: string | null;
  timeZone: string | null;
};

type OpenPracticeSchedule = {
  weekday: Weekday;
};

@Injectable()
export class PracticeLocationActivationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scheduleTime: ScheduleTimeService,
    private readonly scheduleResolution: ScheduleResolutionService,
    private readonly doctorCalendar: DoctorCalendarAvailabilityService,
    private readonly crossLocationConflict: CrossLocationScheduleConflictService,
  ) {}

  activate(
    authenticatedUserId: string,
    dto: ActivatePracticeLocationDto,
    idempotencyKey: string,
  ) {
    return this.changeLifecycle(
      authenticatedUserId,
      dto.practiceLocationId,
      idempotencyKey,
      CommandType.PRACTICE_LOCATION_ACTIVATE,
      PracticeLocationLifecycleStatus.DRAFT,
      'activated',
    );
  }

  reactivate(
    authenticatedUserId: string,
    dto: ReactivatePracticeLocationDto,
    idempotencyKey: string,
  ) {
    return this.changeLifecycle(
      authenticatedUserId,
      dto.practiceLocationId,
      idempotencyKey,
      CommandType.PRACTICE_LOCATION_REACTIVATE,
      PracticeLocationLifecycleStatus.DISABLED,
      'reactivated',
    );
  }

  private async changeLifecycle(
    authenticatedUserId: string,
    practiceLocationId: string,
    idempotencyKey: string,
    commandType:
      | typeof CommandType.PRACTICE_LOCATION_ACTIVATE
      | typeof CommandType.PRACTICE_LOCATION_REACTIVATE,
    requiredSourceStatus:
      | typeof PracticeLocationLifecycleStatus.DRAFT
      | typeof PracticeLocationLifecycleStatus.DISABLED,
    resultKey: 'activated' | 'reactivated',
  ) {
    const key = this.normalizeIdempotencyKey(idempotencyKey);
    const commandIdentityKey = this.hash(
      `${commandType}|${authenticatedUserId}|${practiceLocationId}|${key}`,
    );
    const requestFingerprint = this.hash(
      `${commandType}|${authenticatedUserId}|${practiceLocationId}`,
    );

    return this.prisma.$transaction(async (transaction) => {
      await this.acquireCommandLock(transaction, commandIdentityKey);
      const location = await this.lockPracticeLocation(
        transaction,
        practiceLocationId,
      );
      await this.lockUser(transaction, authenticatedUserId);
      await this.acquireDoctorScheduleLock(transaction, location.doctorProfileId);

      const actor = await transaction.user.findUnique({
        where: { id: authenticatedUserId },
        select: {
          role: true,
          accountStatus: true,
          administrativeRestrictionStatus: true,
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
        return { [resultKey]: true, replayed: true };
      }

      if (location.lifecycleStatus !== requiredSourceStatus) {
        throw new ConflictException(
          requiredSourceStatus === PracticeLocationLifecycleStatus.DRAFT
            ? 'Only a draft practice location may be activated.'
            : 'Only a disabled practice location may be reactivated.',
        );
      }

      const timeZone = location.timeZone?.trim();
      if (!timeZone) {
        throw new ConflictException(
          'Configure the practice location time zone before activation.',
        );
      }
      this.scheduleTime.assertValidTimeZone(timeZone);

      await this.assertNoActiveDuplicate(transaction, location);
      const openSchedules = await this.loadAndValidateOpenSchedules(
        transaction,
        location.id,
      );
      await this.revalidateCurrentScheduleConflicts(
        transaction,
        location,
        timeZone,
        openSchedules,
      );

      const now = new Date();
      await transaction.practiceLocation.update({
        where: { id: location.id },
        data: { lifecycleStatus: PracticeLocationLifecycleStatus.ACTIVE },
      });
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

      return { [resultKey]: true, replayed: false };
    });
  }

  private async loadAndValidateOpenSchedules(
    transaction: TransactionClient,
    practiceLocationId: string,
  ): Promise<OpenPracticeSchedule[]> {
    const schedules = await transaction.practiceSchedule.findMany({
      where: { practiceLocationId },
      select: {
        weekday: true,
        isOpen: true,
        opensAtLocal: true,
        closesAtLocal: true,
      },
      orderBy: { weekday: 'asc' },
    });
    const open = schedules.filter((row) => row.isOpen);
    if (open.length === 0) {
      throw new ConflictException(
        'At least one open recurring clinic-hours schedule is required before activation.',
      );
    }
    for (const row of schedules) {
      if (row.isOpen) {
        if (!row.opensAtLocal || !row.closesAtLocal) {
          throw new ConflictException(
            'Every open recurring clinic schedule requires opening and closing times.',
          );
        }
        if (row.closesAtLocal.getTime() <= row.opensAtLocal.getTime()) {
          throw new ConflictException(
            'Every open recurring clinic schedule must close after opening.',
          );
        }
      } else if (row.opensAtLocal || row.closesAtLocal) {
        throw new ConflictException(
          'Closed recurring clinic schedules must not retain opening or closing times.',
        );
      }
    }
    return open.map((row) => ({ weekday: row.weekday }));
  }

  private async revalidateCurrentScheduleConflicts(
    transaction: TransactionClient,
    location: LockedPracticeLocation,
    timeZone: string,
    openSchedules: OpenPracticeSchedule[],
  ): Promise<void> {
    const today = this.localDateParts(new Date(), timeZone);
    for (const schedule of openSchedules) {
      const serviceDate = this.nextOrSameWeekday(today, schedule.weekday);
      const serviceDateKey = this.dateKey(serviceDate);
      const resolved = await this.scheduleResolution.resolveConfiguredSchedule(
        location.id,
        serviceDateKey,
        transaction,
      );
      if (!resolved.isOpen || !resolved.opensAt || !resolved.closesAt) {
        continue;
      }

      const available = await this.doctorCalendar.isAvailableForInterval(
        location.doctorProfileId,
        resolved.opensAt,
        resolved.closesAt,
        transaction,
      );
      if (!available) {
        continue;
      }

      await this.crossLocationConflict.assertNoConflictForInterval(
        location.doctorProfileId,
        location.id,
        resolved.opensAt,
        resolved.closesAt,
        transaction,
      );
    }
  }

  private async assertNoActiveDuplicate(
    transaction: TransactionClient,
    location: LockedPracticeLocation,
  ): Promise<void> {
    const name = location.name?.trim();
    const addressLine1 = location.addressLine1?.trim();
    if (!name || !addressLine1) {
      return;
    }
    const duplicate = await transaction.practiceLocation.findFirst({
      where: {
        id: { not: location.id },
        doctorProfileId: location.doctorProfileId,
        lifecycleStatus: PracticeLocationLifecycleStatus.ACTIVE,
        name: { equals: name, mode: 'insensitive' },
        addressLine1: { equals: addressLine1, mode: 'insensitive' },
      },
      select: { id: true },
    });
    if (duplicate) {
      throw new ConflictException(
        'An active practice location with this name and address already exists.',
      );
    }
  }

  private async lockPracticeLocation(
    transaction: TransactionClient,
    practiceLocationId: string,
  ): Promise<LockedPracticeLocation> {
    const rows = await transaction.$queryRaw<LockedPracticeLocation[]>(Prisma.sql`
      SELECT
        pl."id",
        pl."doctorProfileId",
        pl."lifecycleStatus",
        pl."name",
        pl."addressLine1",
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
        'Only the eligible owning doctor may activate this practice location.',
      );
    }
  }

  private async acquireCommandLock(
    transaction: TransactionClient,
    commandIdentityKey: string,
  ): Promise<void> {
    await transaction.$executeRaw(Prisma.sql`
      SELECT pg_advisory_xact_lock(hashtextextended(${commandIdentityKey}, 0))
    `);
  }

  private async acquireDoctorScheduleLock(
    transaction: TransactionClient,
    doctorProfileId: string,
  ): Promise<void> {
    const scope = `DOCTOR_SCHEDULE|${doctorProfileId}`;
    await transaction.$executeRaw(Prisma.sql`
      SELECT pg_advisory_xact_lock(hashtextextended(${scope}, 0))
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

  private localDateParts(instant: Date, timeZone: string) {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const parts = formatter.formatToParts(instant);
    const get = (type: Intl.DateTimeFormatPartTypes) =>
      Number(parts.find((part) => part.type === type)?.value);
    return { year: get('year'), month: get('month'), day: get('day') };
  }

  private nextOrSameWeekday(
    date: { year: number; month: number; day: number },
    targetWeekday: Weekday,
  ) {
    const names = [
      Weekday.SUNDAY,
      Weekday.MONDAY,
      Weekday.TUESDAY,
      Weekday.WEDNESDAY,
      Weekday.THURSDAY,
      Weekday.FRIDAY,
      Weekday.SATURDAY,
    ];
    const value = new Date(Date.UTC(date.year, date.month - 1, date.day));
    const targetIndex = names.indexOf(targetWeekday);
    const delta = (targetIndex - value.getUTCDay() + 7) % 7;
    value.setUTCDate(value.getUTCDate() + delta);
    return {
      year: value.getUTCFullYear(),
      month: value.getUTCMonth() + 1,
      day: value.getUTCDate(),
    };
  }

  private dateKey(date: { year: number; month: number; day: number }): string {
    return `${String(date.year).padStart(4, '0')}-${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}`;
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
