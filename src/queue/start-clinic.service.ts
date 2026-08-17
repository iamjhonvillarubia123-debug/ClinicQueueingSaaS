import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AdministrativeRestrictionStatus,
  AppointmentStatus,
  ClinicDayStatus,
  CommandType,
  PracticeLocationLifecycleStatus,
  PracticeStaffRole,
  Prisma,
  QueueEventActorType,
  QueueEventAppointmentLinkRole,
  QueueEventType,
  UserAccountStatus,
  UserRole,
  WaitingPlacementType,
} from '../../generated/prisma/client';
import { CommandIdempotencyService } from '../idempotency/command-idempotency.service';
import { PrismaService } from '../prisma/prisma.service';
import { ScheduleResolutionService } from '../schedule/schedule-resolution.service';
import { ScheduleTimeService } from '../schedule/schedule-time.service';
import { StartClinicDto } from './dto/start-clinic.dto';

type TransactionClient = Prisma.TransactionClient;

type StartContext = {
  practiceLocationId: string;
  lifecycleStatus: PracticeLocationLifecycleStatus;
  doctorUserId: string;
  currentRegularPracticeStaffId: string | null;
};

type ActorState = {
  id: string;
  role: UserRole;
  accountStatus: UserAccountStatus;
  administrativeRestrictionStatus: AdministrativeRestrictionStatus;
};

type ExistingClinicDay = {
  id: string;
  status: ClinicDayStatus;
  operatingPracticeStaffId: string | null;
};

type FirstWaiting = {
  id: string;
  status: AppointmentStatus;
  servingOrderKey: Prisma.Decimal | null;
  waitingPlacementType: WaitingPlacementType | null;
};

type OperatingStaff = {
  id: string;
  userId: string;
  isActive: boolean;
  staffRole: PracticeStaffRole;
  userRole: UserRole;
  userAccountStatus: UserAccountStatus;
  administrativeRestrictionStatus: AdministrativeRestrictionStatus;
};

@Injectable()
export class StartClinicService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly idempotency: CommandIdempotencyService,
    private readonly scheduleResolution: ScheduleResolutionService,
    private readonly scheduleTime: ScheduleTimeService,
  ) {}

  async start(
    authenticatedUserId: string,
    dto: StartClinicDto,
    idempotencyKey: string,
  ) {
    const key = this.idempotency.normalizeKey(idempotencyKey);
    const parsedServiceDate = this.scheduleTime.parseServiceDate(
      dto.serviceDate,
    );
    const dateValue = new Date(
      Date.UTC(
        parsedServiceDate.year,
        parsedServiceDate.month - 1,
        parsedServiceDate.day,
      ),
    );
    const commandType = CommandType.START_CLINIC;
    const scope = {
      practiceLocationId: dto.practiceLocationId,
      serviceDate: dto.serviceDate,
      actorUserId: authenticatedUserId,
    };
    const commandIdentityKey = this.idempotency.deriveIdentity({
      idempotencyKey: key,
      commandType,
      scope,
    });
    const requestFingerprint = this.idempotency.fingerprint(scope);

    return this.prisma.$transaction(async (transaction) => {
      await this.idempotency.acquireCommandLock(
        transaction,
        commandIdentityKey,
      );
      const replay = await this.idempotency.findReplay(
        transaction,
        commandIdentityKey,
        requestFingerprint,
      );
      if (replay) {
        const clinicDay = await transaction.clinicDay.findUnique({
          where: {
            practiceLocationId_serviceDate: {
              practiceLocationId: dto.practiceLocationId,
              serviceDate: dateValue,
            },
          },
          select: { id: true, status: true, startedAt: true },
        });
        return {
          started: true,
          replayed: true,
          clinicDayId: clinicDay?.id ?? null,
          clinicDayStatus: clinicDay?.status ?? null,
          startedAt: clinicDay?.startedAt ?? null,
          calledAppointmentId: replay.resultAppointmentId,
          queueEventId: replay.resultQueueEventId,
        };
      }

      await this.acquireQueueScopeLock(
        transaction,
        dto.practiceLocationId,
        dateValue,
      );

      const context = await this.lockStartContext(
        transaction,
        dto.practiceLocationId,
      );
      await this.lockUser(transaction, authenticatedUserId);
      const actor = await transaction.user.findUnique({
        where: { id: authenticatedUserId },
        select: {
          id: true,
          role: true,
          accountStatus: true,
          administrativeRestrictionStatus: true,
        },
      });
      this.assertEligibleActor(actor);

      const schedule =
        await this.scheduleResolution.resolveOperationalSchedule(
          dto.practiceLocationId,
          dto.serviceDate,
          transaction,
        );
      if (!schedule.isOpen) {
        throw new ConflictException(
          'Clinic cannot be started on a closed or unavailable Service Date.',
        );
      }

      const existingClinicDay = await this.lockClinicDay(
        transaction,
        dto.practiceLocationId,
        dateValue,
      );
      if (
        existingClinicDay &&
        existingClinicDay.status !== ClinicDayStatus.NOT_STARTED &&
        existingClinicDay.status !== ClinicDayStatus.DELAYED
      ) {
        throw new ConflictException('Clinic day cannot be started again.');
      }

      const operatingPracticeStaffId =
        await this.assertActorAuthorityAndResolveOperatingStaff(
          transaction,
          context,
          existingClinicDay,
          actor,
        );

      const now = new Date();
      const clinicDay = existingClinicDay
        ? await transaction.clinicDay.update({
            where: { id: existingClinicDay.id },
            data: {
              status: ClinicDayStatus.STARTED,
              startedAt: now,
              operatingPracticeStaffId,
              maximumOnlineBookingUntilAt: schedule.maximumOnlineBookingUntilAt,
            },
            select: { id: true, status: true, startedAt: true },
          })
        : await transaction.clinicDay.create({
            data: {
              practiceLocationId: dto.practiceLocationId,
              serviceDate: dateValue,
              status: ClinicDayStatus.STARTED,
              startedAt: now,
              operatingPracticeStaffId,
              maximumOnlineBookingUntilAt: schedule.maximumOnlineBookingUntilAt,
            },
            select: { id: true, status: true, startedAt: true },
          });

      const firstWaiting = await this.lockFirstWaitingAppointment(
        transaction,
        dto.practiceLocationId,
        dateValue,
      );
      if (firstWaiting) {
        await transaction.appointment.update({
          where: { id: firstWaiting.id },
          data: {
            status: AppointmentStatus.CALLED,
            servingOrderKey: null,
            waitingPlacementType: null,
          },
        });
      }

      const queueEventSequence = await this.nextQueueEventSequence(
        transaction,
        dto.practiceLocationId,
        dateValue,
      );
      const queueEvent = await transaction.queueEvent.create({
        data: {
          practiceLocationId: dto.practiceLocationId,
          serviceDate: dateValue,
          queueEventSequence,
          type: QueueEventType.START_CLINIC,
          actorType: QueueEventActorType.USER,
          actorUserId: authenticatedUserId,
          previousPrimaryStatus: firstWaiting?.status ?? null,
          newPrimaryStatus: firstWaiting ? AppointmentStatus.CALLED : null,
          previousPrimaryOrderKey: firstWaiting?.servingOrderKey ?? null,
          newPrimaryOrderKey: null,
          previousPrimaryWaitingPlacementType:
            firstWaiting?.waitingPlacementType ?? null,
          newPrimaryWaitingPlacementType: null,
          metadata: {
            clinicDayId: clinicDay.id,
            startedEmpty: firstWaiting === null,
          },
          createdAt: now,
        },
        select: { id: true },
      });

      if (firstWaiting) {
        await transaction.queueEventAppointmentLink.create({
          data: {
            queueEventId: queueEvent.id,
            role: QueueEventAppointmentLinkRole.PRIMARY,
            appointmentId: firstWaiting.id,
          },
        });
      }

      const completion = this.idempotency.completionTimes(now);
      await transaction.commandIdempotency.create({
        data: {
          idempotencyKey: key,
          commandIdentityKey,
          commandType,
          requestFingerprint,
          practiceLocationId: dto.practiceLocationId,
          serviceDate: dateValue,
          actorUserId: authenticatedUserId,
          resultAppointmentId: firstWaiting?.id ?? null,
          resultQueueEventId: queueEvent.id,
          completedAt: completion.completedAt,
          expiresAt: completion.expiresAt,
          createdAt: now,
        },
      });

      return {
        started: true,
        replayed: false,
        clinicDayId: clinicDay.id,
        clinicDayStatus: clinicDay.status,
        startedAt: clinicDay.startedAt,
        calledAppointmentId: firstWaiting?.id ?? null,
        queueEventId: queueEvent.id,
      };
    });
  }

  private async acquireQueueScopeLock(
    transaction: TransactionClient,
    practiceLocationId: string,
    serviceDate: Date,
  ): Promise<void> {
    const lockIdentity = `queue|${practiceLocationId}|${serviceDate
      .toISOString()
      .slice(0, 10)}`;
    await transaction.$executeRaw(Prisma.sql`
      SELECT pg_advisory_xact_lock(hashtextextended(${lockIdentity}, 0))
    `);
  }

  private async lockStartContext(
    transaction: TransactionClient,
    practiceLocationId: string,
  ): Promise<StartContext> {
    const rows = await transaction.$queryRaw<StartContext[]>(Prisma.sql`
      SELECT
        pl."id" AS "practiceLocationId",
        pl."lifecycleStatus",
        pl."currentRegularPracticeStaffId",
        dp."userId" AS "doctorUserId"
      FROM "PracticeLocation" pl
      INNER JOIN "DoctorProfile" dp ON dp."id" = pl."doctorProfileId"
      WHERE pl."id" = ${practiceLocationId}
      LIMIT 1
      FOR UPDATE OF pl
    `);
    const context = rows[0];
    if (!context) {
      throw new NotFoundException('Practice location was not found.');
    }
    if (context.lifecycleStatus !== PracticeLocationLifecycleStatus.ACTIVE) {
      throw new ConflictException('Practice location is not operational.');
    }
    return context;
  }

  private async lockUser(
    transaction: TransactionClient,
    userId: string,
  ): Promise<void> {
    await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE
    `);
  }

  private assertEligibleActor(
    actor: ActorState | null,
  ): asserts actor is ActorState {
    if (
      !actor ||
      actor.accountStatus !== UserAccountStatus.ACTIVE ||
      actor.administrativeRestrictionStatus !==
        AdministrativeRestrictionStatus.NONE
    ) {
      throw new ForbiddenException(
        'Current user cannot start this clinic day.',
      );
    }
  }

  private async assertActorAuthorityAndResolveOperatingStaff(
    transaction: TransactionClient,
    context: StartContext,
    clinicDay: ExistingClinicDay | null,
    actor: ActorState,
  ): Promise<string | null> {
    if (actor.role === UserRole.DOCTOR) {
      if (actor.id !== context.doctorUserId) {
        throw new ForbiddenException(
          'Current user cannot start this clinic day.',
        );
      }
      return (
        clinicDay?.operatingPracticeStaffId ??
        context.currentRegularPracticeStaffId
      );
    }

    if (actor.role !== UserRole.SECRETARY) {
      throw new ForbiddenException(
        'Current user cannot start this clinic day.',
      );
    }

    const expectedStaffId =
      clinicDay?.operatingPracticeStaffId ??
      context.currentRegularPracticeStaffId;
    if (!expectedStaffId) {
      throw new ForbiddenException(
        'No operating secretary is assigned for this clinic day.',
      );
    }

    const rows = await transaction.$queryRaw<OperatingStaff[]>(Prisma.sql`
      SELECT
        ps."id",
        ps."userId",
        ps."isActive",
        ps."staffRole",
        u."role" AS "userRole",
        u."accountStatus" AS "userAccountStatus",
        u."administrativeRestrictionStatus"
      FROM "PracticeStaff" ps
      INNER JOIN "User" u ON u."id" = ps."userId"
      WHERE ps."id" = ${expectedStaffId}
      LIMIT 1
      FOR UPDATE OF ps, u
    `);
    const operatingStaff = rows[0];
    if (
      !operatingStaff ||
      operatingStaff.userId !== actor.id ||
      !operatingStaff.isActive ||
      operatingStaff.staffRole !== PracticeStaffRole.SECRETARY ||
      operatingStaff.userRole !== UserRole.SECRETARY ||
      operatingStaff.userAccountStatus !== UserAccountStatus.ACTIVE ||
      operatingStaff.administrativeRestrictionStatus !==
        AdministrativeRestrictionStatus.NONE
    ) {
      throw new ForbiddenException(
        'Secretary is not the current operating secretary for this clinic day.',
      );
    }
    return operatingStaff.id;
  }

  private async lockClinicDay(
    transaction: TransactionClient,
    practiceLocationId: string,
    serviceDate: Date,
  ): Promise<ExistingClinicDay | null> {
    const rows = await transaction.$queryRaw<ExistingClinicDay[]>(Prisma.sql`
      SELECT "id", "status", "operatingPracticeStaffId"
      FROM "ClinicDay"
      WHERE "practiceLocationId" = ${practiceLocationId}
        AND "serviceDate" = ${serviceDate}
      LIMIT 1
      FOR UPDATE
    `);
    return rows[0] ?? null;
  }

  private async lockFirstWaitingAppointment(
    transaction: TransactionClient,
    practiceLocationId: string,
    serviceDate: Date,
  ): Promise<FirstWaiting | null> {
    const rows = await transaction.$queryRaw<FirstWaiting[]>(Prisma.sql`
      SELECT
        "id",
        "status",
        "servingOrderKey",
        "waitingPlacementType"
      FROM "Appointment"
      WHERE "practiceLocationId" = ${practiceLocationId}
        AND "serviceDate" = ${serviceDate}
        AND "status" = 'WAITING'::"AppointmentStatus"
        AND "servingOrderKey" IS NOT NULL
      ORDER BY "servingOrderKey" ASC, "queueNumber" ASC, "id" ASC
      LIMIT 1
      FOR UPDATE
    `);
    return rows[0] ?? null;
  }

  private async nextQueueEventSequence(
    transaction: TransactionClient,
    practiceLocationId: string,
    serviceDate: Date,
  ): Promise<bigint> {
    const rows = await transaction.$queryRaw<Array<{ nextSequence: bigint }>>(
      Prisma.sql`
        SELECT COALESCE(MAX("queueEventSequence"), 0)::bigint + 1 AS "nextSequence"
        FROM "QueueEvent"
        WHERE "practiceLocationId" = ${practiceLocationId}
          AND "serviceDate" = ${serviceDate}
      `,
    );
    return rows[0]?.nextSequence ?? 1n;
  }
}
