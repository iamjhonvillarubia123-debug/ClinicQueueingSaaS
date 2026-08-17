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
import { NextPatientDto, NextPatientOutcome } from './dto/next-patient.dto';

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

type QueueAppointment = {
  id: string;
  bookingGroupId: string | null;
  status: AppointmentStatus;
  servingOrderKey: Prisma.Decimal | null;
  waitingPlacementType: WaitingPlacementType | null;
  activeAppointmentKey: string | null;
  calledAt: Date | null;
  completedAt: Date | null;
  terminalAt: Date | null;
};

type BookingGroupState = {
  id: string;
  servingProtectionEndedAt: Date | null;
};

@Injectable()
export class NextPatientService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly idempotency: CommandIdempotencyService,
    private readonly scheduleTime: ScheduleTimeService,
  ) {}

  async advance(
    authenticatedUserId: string,
    dto: NextPatientDto,
    idempotencyKey: string,
  ) {
    const key = this.idempotency.normalizeKey(idempotencyKey);
    const parsedServiceDate = this.scheduleTime.parseServiceDate(
      dto.serviceDate,
    );
    const serviceDate = new Date(
      Date.UTC(
        parsedServiceDate.year,
        parsedServiceDate.month - 1,
        parsedServiceDate.day,
      ),
    );
    const commandType = CommandType.NEXT_PATIENT;
    const identityScope = {
      practiceLocationId: dto.practiceLocationId,
      serviceDate: dto.serviceDate,
      actorUserId: authenticatedUserId,
    };
    const requestPayload = {
      ...identityScope,
      patientOutcome: dto.patientOutcome,
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
          'NEXT PATIENT requires a started clinic day.',
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

      const current = await this.lockCurrentCalledAppointment(
        transaction,
        dto.practiceLocationId,
        serviceDate,
      );
      const next = await this.lockNextWaitingAppointment(
        transaction,
        dto.practiceLocationId,
        serviceDate,
      );
      if (!next) {
        throw new ConflictException(
          'NEXT PATIENT is unavailable because no eligible waiting Appointment exists.',
        );
      }

      const currentOutcome = this.resolveOutcome(dto.patientOutcome);
      const now = new Date();
      const groupProtectionEnded = await this.applyGroupProtectionConsequence(
        transaction,
        current,
        next,
        now,
      );

      await transaction.appointment.update({
        where: { id: current.id },
        data: this.currentAppointmentUpdate(currentOutcome, now),
      });
      await transaction.appointment.update({
        where: { id: next.id },
        data: {
          status: AppointmentStatus.CALLED,
          servingOrderKey: null,
          waitingPlacementType: null,
          calledAt: now,
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
          type: QueueEventType.NEXT_PATIENT,
          actorType: QueueEventActorType.USER,
          actorUserId: authenticatedUserId,
          previousPrimaryStatus: current.status,
          newPrimaryStatus: currentOutcome,
          previousSecondaryStatus: next.status,
          newSecondaryStatus: AppointmentStatus.CALLED,
          previousPrimaryOrderKey: current.servingOrderKey,
          newPrimaryOrderKey: null,
          previousSecondaryOrderKey: next.servingOrderKey,
          newSecondaryOrderKey: null,
          previousPrimaryWaitingPlacementType: current.waitingPlacementType,
          newPrimaryWaitingPlacementType: null,
          previousSecondaryWaitingPlacementType: next.waitingPlacementType,
          newSecondaryWaitingPlacementType: null,
          previousPrimaryTerminalAt: current.terminalAt,
          newPrimaryTerminalAt:
            currentOutcome === AppointmentStatus.COMPLETED ? now : null,
          previousSecondaryTerminalAt: next.terminalAt,
          newSecondaryTerminalAt: next.terminalAt,
          metadata: {
            patientOutcome: dto.patientOutcome,
            previousPrimaryCalledAt: current.calledAt?.toISOString() ?? null,
            previousPrimaryCompletedAt:
              current.completedAt?.toISOString() ?? null,
            previousSecondaryCalledAt: next.calledAt?.toISOString() ?? null,
            groupProtectionEnded,
          },
          createdAt: now,
        },
        select: { id: true },
      });

      await transaction.queueEventAppointmentLink.createMany({
        data: [
          {
            queueEventId: queueEvent.id,
            role: QueueEventAppointmentLinkRole.PRIMARY,
            appointmentId: current.id,
          },
          {
            queueEventId: queueEvent.id,
            role: QueueEventAppointmentLinkRole.SECONDARY,
            appointmentId: next.id,
          },
        ],
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
        previousCalledAppointmentId: current.id,
        previousCalledNewStatus: currentOutcome,
        calledAppointmentId: next.id,
        groupProtectionEnded,
      };
    });
  }

  private async readReplayResult(
    transaction: TransactionClient,
    queueEventId: string | null,
  ) {
    if (!queueEventId) {
      throw new ConflictException('NEXT PATIENT replay record is incomplete.');
    }
    const event = await transaction.queueEvent.findUnique({
      where: { id: queueEventId },
      select: {
        id: true,
        newPrimaryStatus: true,
        metadata: true,
        appointmentLinks: {
          select: { role: true, appointmentId: true },
        },
      },
    });
    if (!event) {
      throw new ConflictException('NEXT PATIENT replay event is unavailable.');
    }
    const primary = event.appointmentLinks.find(
      (link) => link.role === QueueEventAppointmentLinkRole.PRIMARY,
    );
    const secondary = event.appointmentLinks.find(
      (link) => link.role === QueueEventAppointmentLinkRole.SECONDARY,
    );
    if (!primary || !secondary || !event.newPrimaryStatus) {
      throw new ConflictException('NEXT PATIENT replay event is incomplete.');
    }
    const metadata = this.readMetadata(event.metadata);
    return {
      replayed: true,
      queueEventId: event.id,
      previousCalledAppointmentId: primary.appointmentId,
      previousCalledNewStatus: event.newPrimaryStatus,
      calledAppointmentId: secondary.appointmentId,
      groupProtectionEnded: metadata.groupProtectionEnded === true,
    };
  }

  private readMetadata(
    value: Prisma.JsonValue | null,
  ): Record<string, unknown> {
    if (!value || Array.isArray(value) || typeof value !== 'object') {
      return {};
    }
    return value;
  }

  private resolveOutcome(outcome: NextPatientOutcome): AppointmentStatus {
    switch (outcome) {
      case NextPatientOutcome.NOW_SERVING:
        return AppointmentStatus.TEMPORARILY_ABSENT;
      case NextPatientOutcome.COMPLETED:
        return AppointmentStatus.COMPLETED;
      case NextPatientOutcome.OUT_FOR_PROCEDURE:
        return AppointmentStatus.OUT_FOR_PROCEDURE;
    }
  }

  private currentAppointmentUpdate(
    outcome: AppointmentStatus,
    now: Date,
  ): Prisma.AppointmentUpdateInput {
    if (outcome === AppointmentStatus.COMPLETED) {
      return {
        status: outcome,
        servingOrderKey: null,
        waitingPlacementType: null,
        completedAt: now,
        terminalAt: now,
        activeAppointmentKey: null,
      };
    }
    return {
      status: outcome,
      servingOrderKey: null,
      waitingPlacementType: null,
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
    clinicDay: ClinicDayState,
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
      !clinicDay.operatingPracticeStaffId
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

  private async lockCurrentCalledAppointment(
    transaction: TransactionClient,
    practiceLocationId: string,
    serviceDate: Date,
  ): Promise<QueueAppointment> {
    const rows = await transaction.$queryRaw<QueueAppointment[]>(Prisma.sql`
      SELECT
        "id",
        "bookingGroupId",
        "status",
        "servingOrderKey",
        "waitingPlacementType",
        "activeAppointmentKey",
        "calledAt",
        "completedAt",
        "terminalAt"
      FROM "Appointment"
      WHERE "practiceLocationId" = ${practiceLocationId}
        AND "serviceDate" = ${serviceDate}
        AND "status" = 'CALLED'::"AppointmentStatus"
      ORDER BY "calledAt" ASC NULLS FIRST, "queueNumber" ASC, "id" ASC
      FOR UPDATE
    `);
    if (rows.length !== 1) {
      throw new ConflictException(
        'NEXT PATIENT requires exactly one current CALLED Appointment.',
      );
    }
    return rows[0]!;
  }

  private async lockNextWaitingAppointment(
    transaction: TransactionClient,
    practiceLocationId: string,
    serviceDate: Date,
  ): Promise<QueueAppointment | null> {
    const rows = await transaction.$queryRaw<QueueAppointment[]>(Prisma.sql`
      SELECT
        "id",
        "bookingGroupId",
        "status",
        "servingOrderKey",
        "waitingPlacementType",
        "activeAppointmentKey",
        "calledAt",
        "completedAt",
        "terminalAt"
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

  private async applyGroupProtectionConsequence(
    transaction: TransactionClient,
    current: QueueAppointment,
    next: QueueAppointment,
    now: Date,
  ): Promise<boolean> {
    if (!current.bookingGroupId) {
      return false;
    }

    const rows = await transaction.$queryRaw<BookingGroupState[]>(Prisma.sql`
      SELECT "id", "servingProtectionEndedAt"
      FROM "BookingGroup"
      WHERE "id" = ${current.bookingGroupId}
      LIMIT 1
      FOR UPDATE
    `);
    const group = rows[0];
    if (!group || group.servingProtectionEndedAt) {
      return false;
    }

    const nextIsSameGroup = next.bookingGroupId === current.bookingGroupId;
    let shouldEnd = !nextIsSameGroup;
    if (!shouldEnd && nextIsSameGroup) {
      const remainingRows = await transaction.$queryRaw<
        Array<{ count: bigint }>
      >(Prisma.sql`
        SELECT COUNT(*)::bigint AS "count"
        FROM "Appointment"
        WHERE "bookingGroupId" = ${current.bookingGroupId}
          AND "status" = 'WAITING'::"AppointmentStatus"
          AND "id" <> ${next.id}
      `);
      shouldEnd = (remainingRows[0]?.count ?? 0n) === 0n;
    }
    if (!shouldEnd) {
      return false;
    }

    await transaction.bookingGroup.update({
      where: { id: current.bookingGroupId },
      data: { servingProtectionEndedAt: now },
    });
    return true;
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
