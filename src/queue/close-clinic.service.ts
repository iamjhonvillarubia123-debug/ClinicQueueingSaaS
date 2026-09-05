import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AdministrativeRestrictionStatus,
  AppointmentStatus,
  ClinicClosureDisposition,
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
} from '../../generated/prisma/client';
import { CommandIdempotencyService } from '../idempotency/command-idempotency.service';
import { PrismaService } from '../prisma/prisma.service';
import { ScheduleResolutionService } from '../schedule/schedule-resolution.service';
import { ScheduleTimeService } from '../schedule/schedule-time.service';
import { CloseClinicDto } from './dto/close-clinic.dto';

type TransactionClient = Prisma.TransactionClient;

type QueueContext = {
  practiceLocationId: string;
  lifecycleStatus: PracticeLocationLifecycleStatus;
  doctorUserId: string;
  currentRegularPracticeStaffId: string | null;
};

type ClinicDayState = {
  id: string;
  status: ClinicDayStatus;
  operatingPracticeStaffId: string | null;
  closedAt: Date | null;
};

type ActorState = {
  id: string;
  role: UserRole;
  accountStatus: UserAccountStatus;
  administrativeRestrictionStatus: AdministrativeRestrictionStatus;
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

type QueueAppointment = {
  id: string;
  status: AppointmentStatus;
  servingOrderKey: Prisma.Decimal | null;
  waitingPlacementType: string | null;
  activeAppointmentKey: string | null;
  calledAt: Date | null;
  completedAt: Date | null;
  terminalAt: Date | null;
};

@Injectable()
export class CloseClinicService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly idempotency: CommandIdempotencyService,
    private readonly scheduleResolution: ScheduleResolutionService,
    private readonly scheduleTime: ScheduleTimeService,
  ) {}

  async close(
    authenticatedUserId: string,
    dto: CloseClinicDto,
    idempotencyKey: string,
  ) {
    const key = this.idempotency.normalizeKey(idempotencyKey);
    const parsed = this.scheduleTime.parseServiceDate(dto.serviceDate);
    const serviceDate = new Date(
      Date.UTC(parsed.year, parsed.month - 1, parsed.day),
    );
    const commandType = CommandType.CLOSE_CLINIC;
    const identityScope = {
      practiceLocationId: dto.practiceLocationId,
      serviceDate: dto.serviceDate,
      actorUserId: authenticatedUserId,
    };
    const commandIdentityKey = this.idempotency.deriveIdentity({
      idempotencyKey: key,
      commandType,
      scope: identityScope,
    });
    const requestFingerprint = this.idempotency.fingerprint({
      finalPatientDisposition: dto.finalPatientDisposition ?? null,
    });

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
        return this.readReplayResult(transaction, replay.resultQueueEventId);
      }

      await this.acquireQueueScopeLock(
        transaction,
        dto.practiceLocationId,
        serviceDate,
      );

      const context = await this.lockQueueContext(
        transaction,
        dto.practiceLocationId,
      );
      const clinicDay = await this.lockClinicDay(
        transaction,
        dto.practiceLocationId,
        serviceDate,
      );
      if (!clinicDay || clinicDay.status !== ClinicDayStatus.STARTED) {
        throw new ConflictException(
          'CLOSE CLINIC requires a started clinic day.',
        );
      }

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
      await this.assertActorAuthority(transaction, context, clinicDay, actor);

      const schedule = await this.scheduleResolution.resolveConfiguredSchedule(
        dto.practiceLocationId,
        dto.serviceDate,
        transaction,
      );
      if (!schedule.closesAt || Date.now() < schedule.closesAt.getTime()) {
        throw new ConflictException(
          'CLOSE CLINIC is unavailable before the applicable clinic closing time.',
        );
      }

      const waitingCount = await transaction.appointment.count({
        where: {
          practiceLocationId: dto.practiceLocationId,
          serviceDate,
          status: AppointmentStatus.WAITING,
        },
      });
      if (waitingCount > 0) {
        throw new ConflictException(
          'CLOSE CLINIC is unavailable while eligible waiting Appointments remain.',
        );
      }

      const current = await this.lockCurrentCalledAppointment(
        transaction,
        dto.practiceLocationId,
        serviceDate,
      );
      if (current && !dto.finalPatientDisposition) {
        throw new ConflictException(
          'Final patient disposition is required while an Appointment is CALLED.',
        );
      }
      if (!current && dto.finalPatientDisposition) {
        throw new ConflictException(
          'Final patient disposition is not applicable because no Appointment is CALLED.',
        );
      }

      const unresolved = await this.lockUnresolvedAppointments(
        transaction,
        dto.practiceLocationId,
        serviceDate,
      );
      const now = new Date();

      if (current) {
        if (
          dto.finalPatientDisposition === ClinicClosureDisposition.COMPLETED
        ) {
          await transaction.appointment.update({
            where: { id: current.id },
            data: {
              status: AppointmentStatus.COMPLETED,
              servingOrderKey: null,
              waitingPlacementType: null,
              completedAt: now,
              terminalAt: now,
              activeAppointmentKey: null,
            },
          });
        } else if (
          dto.finalPatientDisposition ===
          ClinicClosureDisposition.OUT_FOR_PROCEDURE
        ) {
          await transaction.appointment.update({
            where: { id: current.id },
            data: {
              status: AppointmentStatus.EXPIRED,
              servingOrderKey: null,
              waitingPlacementType: null,
              terminalAt: now,
              activeAppointmentKey: null,
            },
          });
        }
      }

      const unresolvedIds = unresolved.map((appointment) => appointment.id);
      if (unresolvedIds.length > 0) {
        await transaction.appointment.updateMany({
          where: { id: { in: unresolvedIds } },
          data: {
            status: AppointmentStatus.EXPIRED,
            servingOrderKey: null,
            waitingPlacementType: null,
            terminalAt: now,
            activeAppointmentKey: null,
          },
        });
      }

      await transaction.clinicDay.update({
        where: { id: clinicDay.id },
        data: {
          status: ClinicDayStatus.CLOSED,
          closedAt: now,
        },
      });

      const queueEventSequence = await this.nextQueueEventSequence(
        transaction,
        dto.practiceLocationId,
        serviceDate,
      );
      const event = await transaction.queueEvent.create({
        data: {
          practiceLocationId: dto.practiceLocationId,
          serviceDate,
          queueEventSequence,
          type: QueueEventType.QUEUE_CLOSED,
          actorType: QueueEventActorType.USER,
          actorUserId: authenticatedUserId,
          previousPrimaryStatus: current?.status ?? null,
          newPrimaryStatus: current
            ? dto.finalPatientDisposition === ClinicClosureDisposition.COMPLETED
              ? AppointmentStatus.COMPLETED
              : AppointmentStatus.EXPIRED
            : null,
          metadata: {
            finalPatientDisposition: dto.finalPatientDisposition ?? null,
            expiredTemporarilyAbsentCount: unresolved.filter(
              (appointment) =>
                appointment.status === AppointmentStatus.TEMPORARILY_ABSENT,
            ).length,
            expiredOutForProcedureCount: unresolved.filter(
              (appointment) =>
                appointment.status === AppointmentStatus.OUT_FOR_PROCEDURE,
            ).length,
            closedAt: now.toISOString(),
          },
          createdAt: now,
        },
        select: { id: true },
      });

      const links = current
        ? [
            {
              queueEventId: event.id,
              appointmentId: current.id,
              role: QueueEventAppointmentLinkRole.PRIMARY,
            },
          ]
        : [];
      if (links.length > 0) {
        await transaction.queueEventAppointmentLink.createMany({ data: links });
      }

      const completion = this.idempotency.completionTimes(now);
      await transaction.commandIdempotency.create({
        data: {
          idempotencyKey: key,
          commandIdentityKey,
          commandType,
          requestFingerprint,
          practiceLocationId: dto.practiceLocationId,
          serviceDate,
          actorUserId: authenticatedUserId,
          resultQueueEventId: event.id,
          completedAt: completion.completedAt,
          expiresAt: completion.expiresAt,
          createdAt: now,
        },
      });

      return {
        replayed: false,
        queueEventId: event.id,
        clinicDayId: clinicDay.id,
        status: ClinicDayStatus.CLOSED,
        closedAt: now,
        finalAppointmentId: current?.id ?? null,
        finalPatientDisposition: dto.finalPatientDisposition ?? null,
        expiredAppointmentCount: unresolved.length,
      };
    });
  }

  private async readReplayResult(
    transaction: TransactionClient,
    queueEventId: string | null,
  ) {
    if (!queueEventId) {
      throw new ConflictException('CLOSE CLINIC replay record is incomplete.');
    }
    const event = await transaction.queueEvent.findUnique({
      where: { id: queueEventId },
      select: {
        id: true,
        type: true,
        practiceLocationId: true,
        serviceDate: true,
        metadata: true,
      },
    });
    if (!event || event.type !== QueueEventType.QUEUE_CLOSED) {
      throw new ConflictException(
        'CLOSE CLINIC replay result is inconsistent.',
      );
    }
    const clinicDay = await transaction.clinicDay.findUnique({
      where: {
        practiceLocationId_serviceDate: {
          practiceLocationId: event.practiceLocationId,
          serviceDate: event.serviceDate,
        },
      },
      select: { id: true, status: true, closedAt: true },
    });
    if (!clinicDay || clinicDay.status !== ClinicDayStatus.CLOSED) {
      throw new ConflictException(
        'CLOSE CLINIC replay ClinicDay is inconsistent.',
      );
    }
    const metadata =
      event.metadata &&
      !Array.isArray(event.metadata) &&
      typeof event.metadata === 'object'
        ? event.metadata
        : {};
    return {
      replayed: true,
      queueEventId: event.id,
      clinicDayId: clinicDay.id,
      status: clinicDay.status,
      closedAt: clinicDay.closedAt,
      finalPatientDisposition:
        typeof metadata.finalPatientDisposition === 'string'
          ? metadata.finalPatientDisposition
          : null,
    };
  }

  private async lockCurrentCalledAppointment(
    transaction: TransactionClient,
    practiceLocationId: string,
    serviceDate: Date,
  ): Promise<QueueAppointment | null> {
    const rows = await transaction.$queryRaw<QueueAppointment[]>(Prisma.sql`
      SELECT "id", "status", "servingOrderKey", "waitingPlacementType",
             "activeAppointmentKey", "calledAt", "completedAt", "terminalAt"
      FROM "Appointment"
      WHERE "practiceLocationId" = ${practiceLocationId}
        AND "serviceDate" = ${serviceDate}
        AND "status" = ${AppointmentStatus.CALLED}::"AppointmentStatus"
      ORDER BY "calledAt" DESC NULLS LAST, "id" ASC
      FOR UPDATE
    `);
    if (rows.length > 1) {
      throw new ConflictException(
        'Queue state is invalid because multiple Appointments are CALLED.',
      );
    }
    return rows[0] ?? null;
  }

  private async lockUnresolvedAppointments(
    transaction: TransactionClient,
    practiceLocationId: string,
    serviceDate: Date,
  ): Promise<QueueAppointment[]> {
    return transaction.$queryRaw<QueueAppointment[]>(Prisma.sql`
      SELECT "id", "status", "servingOrderKey", "waitingPlacementType",
             "activeAppointmentKey", "calledAt", "completedAt", "terminalAt"
      FROM "Appointment"
      WHERE "practiceLocationId" = ${practiceLocationId}
        AND "serviceDate" = ${serviceDate}
        AND "status" IN (
          ${AppointmentStatus.TEMPORARILY_ABSENT}::"AppointmentStatus",
          ${AppointmentStatus.OUT_FOR_PROCEDURE}::"AppointmentStatus"
        )
      ORDER BY "id" ASC
      FOR UPDATE
    `);
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

  private async lockQueueContext(
    transaction: TransactionClient,
    practiceLocationId: string,
  ): Promise<QueueContext> {
    const rows = await transaction.$queryRaw<QueueContext[]>(Prisma.sql`
      SELECT pl."id" AS "practiceLocationId", pl."lifecycleStatus",
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

  private async lockClinicDay(
    transaction: TransactionClient,
    practiceLocationId: string,
    serviceDate: Date,
  ): Promise<ClinicDayState | null> {
    const rows = await transaction.$queryRaw<ClinicDayState[]>(Prisma.sql`
      SELECT "id", "status", "operatingPracticeStaffId", "closedAt"
      FROM "ClinicDay"
      WHERE "practiceLocationId" = ${practiceLocationId}
        AND "serviceDate" = ${serviceDate}
      LIMIT 1
      FOR UPDATE
    `);
    return rows[0] ?? null;
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
        'Current user cannot close this clinic day.',
      );
    }
  }

  private async assertActorAuthority(
    transaction: TransactionClient,
    context: QueueContext,
    clinicDay: ClinicDayState,
    actor: ActorState,
  ): Promise<void> {
    if (actor.role === UserRole.DOCTOR) {
      if (actor.id !== context.doctorUserId) {
        throw new ForbiddenException(
          'Current user cannot close this clinic day.',
        );
      }
      return;
    }
    if (
      actor.role !== UserRole.SECRETARY ||
      !clinicDay.operatingPracticeStaffId
    ) {
      throw new ForbiddenException(
        'Current user cannot close this clinic day.',
      );
    }
    const rows = await transaction.$queryRaw<OperatingStaff[]>(Prisma.sql`
      SELECT ps."id", ps."userId", ps."isActive", ps."staffRole",
             u."role" AS "userRole", u."accountStatus" AS "userAccountStatus",
             u."administrativeRestrictionStatus"
      FROM "PracticeStaff" ps
      INNER JOIN "User" u ON u."id" = ps."userId"
      WHERE ps."id" = ${clinicDay.operatingPracticeStaffId}
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

    if (context.currentRegularPracticeStaffId !== operatingStaff.id) {
      return;
    }

    const activeQueueBundle =
      await transaction.practiceStaffAuthorityBundle.findFirst({
        where: {
          practiceStaffId: operatingStaff.id,
          bundleType: 'QUEUE_AND_CLINIC_DAY_OPERATIONS',
          status: 'ACTIVE',
        },
        select: { id: true },
      });
    if (!activeQueueBundle) {
      throw new ForbiddenException(
        'Clinic Secretary lacks Queue and Clinic Day Operations authority.',
      );
    }
  }

  private async nextQueueEventSequence(
    transaction: TransactionClient,
    practiceLocationId: string,
    serviceDate: Date,
  ): Promise<bigint> {
    const latest = await transaction.queueEvent.findFirst({
      where: { practiceLocationId, serviceDate },
      select: { queueEventSequence: true },
      orderBy: { queueEventSequence: 'desc' },
    });
    return (latest?.queueEventSequence ?? 0n) + 1n;
  }
}
