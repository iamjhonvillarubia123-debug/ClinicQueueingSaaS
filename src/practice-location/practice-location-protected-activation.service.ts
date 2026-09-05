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
  CommandType,
  PracticeLocationLifecycleStatus,
  Prisma,
  UserAccountStatus,
  UserRole,
} from '../../generated/prisma/client';
import { PasswordSecurityService } from '../auth/security/password-security.service';
import { PrismaService } from '../prisma/prisma.service';
import { RecurringScheduleConflictService } from '../schedule/recurring-schedule-conflict.service';
import { ScheduleTimeService } from '../schedule/schedule-time.service';
import { ActivatePracticeLocationDto } from './dto/activate-practice-location.dto';

const IDEMPOTENCY_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
type TransactionClient = Prisma.TransactionClient;

type LockedLocation = {
  id: string;
  doctorProfileId: string;
  doctorUserId: string;
  lifecycleStatus: PracticeLocationLifecycleStatus;
  name: string | null;
  addressLine1: string | null;
  timeZone: string | null;
};

@Injectable()
export class PracticeLocationProtectedActivationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwordSecurityService: PasswordSecurityService,
    private readonly recurringScheduleConflict: RecurringScheduleConflictService,
    private readonly scheduleTime: ScheduleTimeService,
  ) {}

  async activate(
    authenticatedUserId: string,
    dto: ActivatePracticeLocationDto,
    idempotencyKey: string,
  ) {
    if (!dto.confirmActivation) {
      throw new BadRequestException('Clinic activation must be confirmed.');
    }
    const key = this.normalizeIdempotencyKey(idempotencyKey);
    const commandType = CommandType.PRACTICE_LOCATION_ACTIVATE;
    const commandIdentityKey = this.hash(
      `${commandType}|${authenticatedUserId}|${dto.practiceLocationId}|${key}`,
    );
    const requestFingerprint = this.hash(
      `${commandType}|${authenticatedUserId}|${dto.practiceLocationId}|confirmed`,
    );

    return this.prisma.$transaction(
      async (transaction) => {
        await this.acquireCommandLock(transaction, commandIdentityKey);
        const location = await this.lockPracticeLocation(
          transaction,
          dto.practiceLocationId,
        );
        await this.lockUser(transaction, authenticatedUserId);
        await this.acquireDoctorScheduleLock(
          transaction,
          location.doctorProfileId,
        );

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
          select: { requestFingerprint: true },
        });
        if (replay) {
          if (replay.requestFingerprint !== requestFingerprint) {
            throw new ConflictException(
              'Idempotency-Key was already used for a different request.',
            );
          }
          return { activated: true, replayed: true };
        }

        if (
          location.lifecycleStatus !== PracticeLocationLifecycleStatus.DRAFT
        ) {
          throw new ConflictException(
            'Only a draft practice location may be activated.',
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

        this.assertRequiredClinicIdentity(location);

        const timeZone = location.timeZone?.trim();
        if (!timeZone) {
          throw new ConflictException(
            'Configure the practice location time zone before activation.',
          );
        }
        this.scheduleTime.assertValidTimeZone(timeZone);

        await this.assertNoActiveDuplicate(transaction, location);
        await this.assertValidActivationSchedule(transaction, location.id);
        await this.recurringScheduleConflict.assertNoConflictForLocation(
          location.doctorProfileId,
          location.id,
          timeZone,
          transaction,
        );

        const now = new Date();
        await transaction.practiceLocation.update({
          where: { id: location.id },
          data: { lifecycleStatus: PracticeLocationLifecycleStatus.ACTIVE },
        });
        const command = await transaction.commandIdempotency.create({
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
          select: { id: true },
        });

        await transaction.$executeRaw(Prisma.sql`
          INSERT INTO "PracticeLocationConfigurationAudit" (
            "practiceLocationId",
            "actorUserId",
            "commandIdempotencyId",
            "actionType",
            "changedSections",
            "occurredAt"
          ) VALUES (
            ${location.id}::text,
            ${authenticatedUserId}::text,
            ${command.id}::text,
            'ACTIVATE',
            ${JSON.stringify(['LIFECYCLE', 'CLINIC_HOURS'])}::jsonb,
            ${now}
          )
        `);

        return { activated: true, replayed: false };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  private assertRequiredClinicIdentity(location: LockedLocation): void {
    if (!location.name?.trim()) {
      throw new ConflictException(
        'Enter the clinic name before activation.',
      );
    }
    if (!location.addressLine1?.trim()) {
      throw new ConflictException(
        'Enter the clinic address before activation.',
      );
    }
  }

  private async assertValidActivationSchedule(
    transaction: TransactionClient,
    practiceLocationId: string,
  ) {
    const schedules = await transaction.practiceSchedule.findMany({
      where: { practiceLocationId },
      select: {
        isOpen: true,
        opensAtLocal: true,
        closesAtLocal: true,
        maximumOperatingUntilLocal: true,
      },
    });
    const open = schedules.filter((schedule) => schedule.isOpen);
    if (!open.length) {
      throw new ConflictException(
        'At least one open recurring clinic-hours schedule is required before activation.',
      );
    }
    for (const schedule of schedules) {
      if (!schedule.isOpen) {
        if (schedule.opensAtLocal || schedule.closesAtLocal) {
          throw new ConflictException(
            'Closed recurring clinic schedules must not retain opening or closing times.',
          );
        }
        continue;
      }
      if (!schedule.opensAtLocal || !schedule.closesAtLocal) {
        throw new ConflictException(
          'Every open recurring clinic schedule requires opening and closing times.',
        );
      }
      if (schedule.closesAtLocal <= schedule.opensAtLocal) {
        throw new ConflictException(
          'Every open recurring clinic schedule must close after opening.',
        );
      }
      if (
        schedule.maximumOperatingUntilLocal &&
        schedule.maximumOperatingUntilLocal < schedule.closesAtLocal
      ) {
        throw new ConflictException(
          'Maximum operating time cannot be earlier than clinic closing time.',
        );
      }
    }
  }

  private async assertNoActiveDuplicate(
    transaction: TransactionClient,
    location: LockedLocation,
  ) {
    const name = location.name?.trim();
    const addressLine1 = location.addressLine1?.trim();
    if (!name || !addressLine1) return;
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
  ): Promise<LockedLocation> {
    const rows = await transaction.$queryRaw<LockedLocation[]>(Prisma.sql`
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
    if (!location)
      throw new NotFoundException('Practice location was not found.');
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
    location: LockedLocation,
  ) {
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
  ) {
    await transaction.$executeRaw(Prisma.sql`
      SELECT pg_advisory_xact_lock(hashtextextended(${commandIdentityKey}, 0))
    `);
  }

  private async acquireDoctorScheduleLock(
    transaction: TransactionClient,
    doctorProfileId: string,
  ) {
    const scope = `DOCTOR_SCHEDULE|${doctorProfileId}`;
    await transaction.$executeRaw(Prisma.sql`
      SELECT pg_advisory_xact_lock(hashtextextended(${scope}, 0))
    `);
  }

  private async lockUser(transaction: TransactionClient, userId: string) {
    await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id" FROM "User" WHERE "id" = ${userId} LIMIT 1 FOR UPDATE
    `);
  }

  private normalizeIdempotencyKey(value: string) {
    const normalized = value?.trim();
    if (!normalized) {
      throw new BadRequestException('Idempotency-Key header is required.');
    }
    if (normalized.length > 100) {
      throw new BadRequestException('Idempotency-Key is too long.');
    }
    return normalized;
  }

  private hash(value: string) {
    return createHash('sha256').update(value, 'utf8').digest('hex');
  }
}
