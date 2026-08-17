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
import { ScheduleTimeService } from '../schedule/schedule-time.service';
import { ReturnToQueueDto } from './dto/return-to-queue.dto';
import { QueueServingOrderPlacementService } from './queue-serving-order-placement.service';

type TransactionClient = Prisma.TransactionClient;

type QueueContext = {
  practiceLocationId: string;
  lifecycleStatus: PracticeLocationLifecycleStatus;
  doctorUserId: string;
};

type ClinicDayState = {
  id: string;
  status: ClinicDayStatus;
  operatingPracticeStaffId: string | null;
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

type TargetAppointment = {
  id: string;
  status: AppointmentStatus;
  servingOrderKey: Prisma.Decimal | null;
  waitingPlacementType: WaitingPlacementType | null;
  queueNumber: number;
};

@Injectable()
export class ReturnToQueueService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly idempotency: CommandIdempotencyService,
    private readonly scheduleTime: ScheduleTimeService,
    private readonly placement: QueueServingOrderPlacementService,
  ) {}

  async returnToQueue(
    authenticatedUserId: string,
    dto: ReturnToQueueDto,
    idempotencyKey: string,
  ) {
    const key = this.idempotency.normalizeKey(idempotencyKey);
    const serviceDate = this.parseServiceDate(dto.serviceDate);
    const commandType = CommandType.RETURN_TO_QUEUE;
    const identityScope = {
      practiceLocationId: dto.practiceLocationId,
      serviceDate: dto.serviceDate,
      actorUserId: authenticatedUserId,
    };
    const requestPayload = {
      ...identityScope,
      appointmentId: dto.appointmentId,
    };
    const commandIdentityKey = this.idempotency.deriveIdentity({
      idempotencyKey: key,
      commandType,
      scope: identityScope,
    });
    const requestFingerprint = this.idempotency.fingerprint(requestPayload);

    return this.prisma.$transaction(async (transaction) => {
      await this.idempotency.acquireCommandLock(
        transaction,
        commandIdentityKey,
      );
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

      const replay = await this.idempotency.findReplay(
        transaction,
        commandIdentityKey,
        requestFingerprint,
      );
      if (replay) {
        return this.readReplayResult(
          transaction,
          replay.resultQueueEventId,
          dto.practiceLocationId,
          serviceDate,
          dto.appointmentId,
        );
      }

      if (!clinicDay || clinicDay.status !== ClinicDayStatus.STARTED) {
        throw new ConflictException(
          'RETURN TO QUEUE requires a started clinic day.',
        );
      }

      const target = await this.lockTargetAppointment(
        transaction,
        dto.appointmentId,
        dto.practiceLocationId,
        serviceDate,
      );
      if (target.status !== AppointmentStatus.OUT_FOR_PROCEDURE) {
        throw new ConflictException(
          'Appointment is not eligible to return from procedure.',
        );
      }

      const servingOrderKey =
        await this.placement.calculateReturnToQueuePlacement(
          transaction,
          dto.practiceLocationId,
          serviceDate,
        );
      const now = new Date();

      await transaction.appointment.update({
        where: { id: target.id },
        data: {
          status: AppointmentStatus.WAITING,
          servingOrderKey,
          waitingPlacementType: WaitingPlacementType.RETURN_TO_QUEUE,
        },
      });

      const queueEventSequence = await this.nextQueueEventSequence(
        transaction,
        dto.practiceLocationId,
        serviceDate,
      );
      const queueEvent = await transaction.queueEvent.create({
        data: {
          practiceLocationId: dto.practiceLocationId,
          serviceDate,
          queueEventSequence,
          type: QueueEventType.RETURN_TO_QUEUE,
          actorType: QueueEventActorType.USER,
          actorUserId: authenticatedUserId,
          previousPrimaryStatus: target.status,
          newPrimaryStatus: AppointmentStatus.WAITING,
          previousPrimaryOrderKey: target.servingOrderKey,
          newPrimaryOrderKey: servingOrderKey,
          previousPrimaryWaitingPlacementType: target.waitingPlacementType,
          newPrimaryWaitingPlacementType: WaitingPlacementType.RETURN_TO_QUEUE,
          createdAt: now,
        },
        select: { id: true },
      });

      await transaction.queueEventAppointmentLink.create({
        data: {
          queueEventId: queueEvent.id,
          role: QueueEventAppointmentLinkRole.PRIMARY,
          appointmentId: target.id,
        },
      });

      const completion = this.idempotency.completionTimes(now);
      await transaction.commandIdempotency.create({
        data: {
          idempotencyKey: key,
          commandIdentityKey,
          commandType,
          requestFingerprint,
          practiceLocationId: dto.practiceLocationId,
          serviceDate,
          appointmentId: target.id,
          actorUserId: authenticatedUserId,
          resultQueueEventId: queueEvent.id,
          completedAt: completion.completedAt,
          expiresAt: completion.expiresAt,
          createdAt: now,
        },
      });

      return {
        replayed: false,
        queueEventId: queueEvent.id,
        appointmentId: target.id,
        queueNumber: target.queueNumber,
        status: AppointmentStatus.WAITING,
        waitingPlacementType: WaitingPlacementType.RETURN_TO_QUEUE,
        servingOrderKey: servingOrderKey.toString(),
      };
    });
  }

  private parseServiceDate(value: string): Date {
    const parsed = this.scheduleTime.parseServiceDate(value);
    return new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day));
  }

  private async readReplayResult(
    transaction: TransactionClient,
    queueEventId: string | null,
    practiceLocationId: string,
    serviceDate: Date,
    appointmentId: string,
  ) {
    if (!queueEventId) {
      throw new ConflictException(
        'RETURN TO QUEUE replay record is incomplete.',
      );
    }

    const event = await transaction.queueEvent.findUnique({
      where: { id: queueEventId },
      select: {
        id: true,
        type: true,
        practiceLocationId: true,
        serviceDate: true,
        appointmentLinks: {
          select: { role: true, appointmentId: true },
        },
      },
    });
    const primary = event?.appointmentLinks.find(
      (link) => link.role === QueueEventAppointmentLinkRole.PRIMARY,
    );
    if (
      !event ||
      event.type !== QueueEventType.RETURN_TO_QUEUE ||
      event.practiceLocationId !== practiceLocationId ||
      event.serviceDate.getTime() !== serviceDate.getTime() ||
      !primary ||
      primary.appointmentId !== appointmentId
    ) {
      throw new ConflictException(
        'RETURN TO QUEUE replay result is inconsistent.',
      );
    }

    const appointment = await transaction.appointment.findUnique({
      where: { id: appointmentId },
      select: {
        id: true,
        queueNumber: true,
        status: true,
        waitingPlacementType: true,
        servingOrderKey: true,
      },
    });
    if (!appointment) {
      throw new ConflictException(
        'RETURN TO QUEUE replay Appointment is unavailable.',
      );
    }

    return {
      replayed: true,
      queueEventId: event.id,
      appointmentId: appointment.id,
      queueNumber: appointment.queueNumber,
      status: appointment.status,
      waitingPlacementType: appointment.waitingPlacementType,
      servingOrderKey: appointment.servingOrderKey?.toString() ?? null,
    };
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
      SELECT
        pl."id" AS "practiceLocationId",
        pl."lifecycleStatus",
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
      SELECT "id", "status", "operatingPracticeStaffId"
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
        'Current user cannot operate this clinic day.',
      );
    }
  }

  private async assertActorAuthority(
    transaction: TransactionClient,
    context: QueueContext,
    clinicDay: ClinicDayState | null,
    actor: ActorState,
  ): Promise<void> {
    if (actor.role === UserRole.DOCTOR) {
      if (actor.id !== context.doctorUserId) {
        throw new ForbiddenException(
          'Current user cannot operate this clinic day.',
        );
      }
      return;
    }
    if (
      actor.role !== UserRole.SECRETARY ||
      !clinicDay?.operatingPracticeStaffId
    ) {
      throw new ForbiddenException(
        'Current user cannot operate this clinic day.',
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
  }

  private async lockTargetAppointment(
    transaction: TransactionClient,
    appointmentId: string,
    practiceLocationId: string,
    serviceDate: Date,
  ): Promise<TargetAppointment> {
    const rows = await transaction.$queryRaw<TargetAppointment[]>(Prisma.sql`
      SELECT
        "id",
        "status",
        "servingOrderKey",
        "waitingPlacementType",
        "queueNumber"
      FROM "Appointment"
      WHERE "id" = ${appointmentId}
        AND "practiceLocationId" = ${practiceLocationId}
        AND "serviceDate" = ${serviceDate}
      LIMIT 1
      FOR UPDATE
    `);
    const target = rows[0];
    if (!target) {
      throw new NotFoundException('Appointment was not found in this queue.');
    }
    return target;
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
