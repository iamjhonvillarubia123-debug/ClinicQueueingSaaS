import { createHash } from 'crypto';
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
} from '../../generated/prisma/client';
import { CommandIdempotencyService } from '../idempotency/command-idempotency.service';
import { PrismaService } from '../prisma/prisma.service';
import { ScheduleTimeService } from '../schedule/schedule-time.service';
import { UndoQueueDto } from './dto/undo-queue.dto';

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

type LockedAppointment = {
  id: string;
  bookingGroupId: string | null;
  practiceLocationId: string;
  serviceDate: Date;
  mobileNumberHash: string | null;
  anonymizedAt: Date | null;
  status: AppointmentStatus;
  servingOrderKey: Prisma.Decimal | null;
  waitingPlacementType: string | null;
  activeAppointmentKey: string | null;
  calledAt: Date | null;
  completedAt: Date | null;
  terminalAt: Date | null;
};

type EventMetadata = Record<string, unknown>;

@Injectable()
export class UndoQueueService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly idempotency: CommandIdempotencyService,
    private readonly scheduleTime: ScheduleTimeService,
  ) {}

  async undo(
    authenticatedUserId: string,
    dto: UndoQueueDto,
    idempotencyKey: string,
  ) {
    const key = this.idempotency.normalizeKey(idempotencyKey);
    const serviceDate = this.parseServiceDate(dto.serviceDate);
    const commandType = CommandType.UNDO;
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
    const requestFingerprint = this.idempotency.fingerprint({});

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
        );
      }

      if (!clinicDay || clinicDay.status !== ClinicDayStatus.STARTED) {
        throw new ConflictException('UNDO requires a started clinic day.');
      }

      const original = await this.findUndoCandidate(
        transaction,
        dto.practiceLocationId,
        serviceDate,
      );
      if (!original || original.type !== QueueEventType.NEXT_PATIENT) {
        throw new ConflictException(
          'No eligible queue operation is available to undo.',
        );
      }

      const primaryLink = original.appointmentLinks.find(
        (link) => link.role === QueueEventAppointmentLinkRole.PRIMARY,
      );
      const secondaryLink = original.appointmentLinks.find(
        (link) => link.role === QueueEventAppointmentLinkRole.SECONDARY,
      );
      if (
        !primaryLink ||
        !secondaryLink ||
        !original.previousPrimaryStatus ||
        !original.newPrimaryStatus ||
        !original.previousSecondaryStatus ||
        !original.newSecondaryStatus
      ) {
        throw new ConflictException('UNDO source event is incomplete.');
      }

      const primary = await this.lockAppointment(
        transaction,
        primaryLink.appointmentId,
        dto.practiceLocationId,
        serviceDate,
      );
      const secondary = await this.lockAppointment(
        transaction,
        secondaryLink.appointmentId,
        dto.practiceLocationId,
        serviceDate,
      );
      this.assertCurrentStateMatchesEvent(primary, secondary, original);

      const metadata = this.readMetadata(original.metadata);
      const primaryActiveKey = await this.restorePrimaryActiveKey(
        transaction,
        primary,
        original.previousPrimaryStatus,
      );
      const previousPrimaryCalledAt = this.readDate(
        metadata.previousPrimaryCalledAt,
      );
      const previousPrimaryCompletedAt = this.readDate(
        metadata.previousPrimaryCompletedAt,
      );
      const previousSecondaryCalledAt = this.readDate(
        metadata.previousSecondaryCalledAt,
      );
      const now = new Date();

      await transaction.appointment.update({
        where: { id: primary.id },
        data: {
          status: original.previousPrimaryStatus,
          servingOrderKey: original.previousPrimaryOrderKey,
          waitingPlacementType: original.previousPrimaryWaitingPlacementType,
          calledAt: previousPrimaryCalledAt,
          completedAt: previousPrimaryCompletedAt,
          terminalAt: original.previousPrimaryTerminalAt,
          activeAppointmentKey: primaryActiveKey,
        },
      });
      await transaction.appointment.update({
        where: { id: secondary.id },
        data: {
          status: original.previousSecondaryStatus,
          servingOrderKey: original.previousSecondaryOrderKey,
          waitingPlacementType: original.previousSecondaryWaitingPlacementType,
          calledAt: previousSecondaryCalledAt,
          terminalAt: original.previousSecondaryTerminalAt,
        },
      });

      if (metadata.groupProtectionEnded === true && primary.bookingGroupId) {
        await transaction.bookingGroup.update({
          where: { id: primary.bookingGroupId },
          data: { servingProtectionEndedAt: null },
        });
      }

      const queueEventSequence = await this.nextQueueEventSequence(
        transaction,
        dto.practiceLocationId,
        serviceDate,
      );
      const undoEvent = await transaction.queueEvent.create({
        data: {
          practiceLocationId: dto.practiceLocationId,
          serviceDate,
          queueEventSequence,
          type: QueueEventType.UNDO,
          actorType: QueueEventActorType.USER,
          actorUserId: authenticatedUserId,
          reversesQueueEventId: original.id,
          previousPrimaryStatus: original.newPrimaryStatus,
          newPrimaryStatus: original.previousPrimaryStatus,
          previousSecondaryStatus: original.newSecondaryStatus,
          newSecondaryStatus: original.previousSecondaryStatus,
          previousPrimaryOrderKey: original.newPrimaryOrderKey,
          newPrimaryOrderKey: original.previousPrimaryOrderKey,
          previousSecondaryOrderKey: original.newSecondaryOrderKey,
          newSecondaryOrderKey: original.previousSecondaryOrderKey,
          previousPrimaryWaitingPlacementType:
            original.newPrimaryWaitingPlacementType,
          newPrimaryWaitingPlacementType:
            original.previousPrimaryWaitingPlacementType,
          previousSecondaryWaitingPlacementType:
            original.newSecondaryWaitingPlacementType,
          newSecondaryWaitingPlacementType:
            original.previousSecondaryWaitingPlacementType,
          previousPrimaryTerminalAt: original.newPrimaryTerminalAt,
          newPrimaryTerminalAt: original.previousPrimaryTerminalAt,
          previousSecondaryTerminalAt: original.newSecondaryTerminalAt,
          newSecondaryTerminalAt: original.previousSecondaryTerminalAt,
          metadata: {
            reversedEventType: original.type,
            reversedQueueEventSequence: original.queueEventSequence.toString(),
            restoredPrimaryCalledAt:
              previousPrimaryCalledAt?.toISOString() ?? null,
            restoredPrimaryCompletedAt:
              previousPrimaryCompletedAt?.toISOString() ?? null,
            restoredSecondaryCalledAt:
              previousSecondaryCalledAt?.toISOString() ?? null,
            restoredGroupProtection:
              metadata.groupProtectionEnded === true &&
              primary.bookingGroupId !== null,
          },
          createdAt: now,
        },
        select: { id: true },
      });

      await transaction.queueEventAppointmentLink.createMany({
        data: [
          {
            queueEventId: undoEvent.id,
            role: QueueEventAppointmentLinkRole.PRIMARY,
            appointmentId: primary.id,
          },
          {
            queueEventId: undoEvent.id,
            role: QueueEventAppointmentLinkRole.SECONDARY,
            appointmentId: secondary.id,
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
          resultQueueEventId: undoEvent.id,
          completedAt: completion.completedAt,
          expiresAt: completion.expiresAt,
          createdAt: now,
        },
      });

      return {
        replayed: false,
        queueEventId: undoEvent.id,
        reversedQueueEventId: original.id,
        restoredPrimaryAppointmentId: primary.id,
        restoredPrimaryStatus: original.previousPrimaryStatus,
        restoredSecondaryAppointmentId: secondary.id,
        restoredSecondaryStatus: original.previousSecondaryStatus,
      };
    });
  }

  private parseServiceDate(value: string): Date {
    const parsed = this.scheduleTime.parseServiceDate(value);
    return new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day));
  }

  private async findUndoCandidate(
    transaction: TransactionClient,
    practiceLocationId: string,
    serviceDate: Date,
  ) {
    const events = await transaction.queueEvent.findMany({
      where: { practiceLocationId, serviceDate },
      orderBy: { queueEventSequence: 'desc' },
      select: {
        id: true,
        queueEventSequence: true,
        type: true,
        reversesQueueEventId: true,
        previousPrimaryStatus: true,
        newPrimaryStatus: true,
        previousSecondaryStatus: true,
        newSecondaryStatus: true,
        previousPrimaryOrderKey: true,
        newPrimaryOrderKey: true,
        previousSecondaryOrderKey: true,
        newSecondaryOrderKey: true,
        previousPrimaryWaitingPlacementType: true,
        newPrimaryWaitingPlacementType: true,
        previousSecondaryWaitingPlacementType: true,
        newSecondaryWaitingPlacementType: true,
        previousPrimaryTerminalAt: true,
        newPrimaryTerminalAt: true,
        previousSecondaryTerminalAt: true,
        newSecondaryTerminalAt: true,
        metadata: true,
        appointmentLinks: {
          select: { role: true, appointmentId: true },
        },
      },
    });
    const reversed = new Set(
      events
        .filter((event) => event.type === QueueEventType.UNDO)
        .map((event) => event.reversesQueueEventId)
        .filter((value): value is string => Boolean(value)),
    );
    return events.find(
      (event) => event.type !== QueueEventType.UNDO && !reversed.has(event.id),
    );
  }

  private async readReplayResult(
    transaction: TransactionClient,
    queueEventId: string | null,
    practiceLocationId: string,
    serviceDate: Date,
  ) {
    if (!queueEventId) {
      throw new ConflictException('UNDO replay record is incomplete.');
    }
    const event = await transaction.queueEvent.findUnique({
      where: { id: queueEventId },
      select: {
        id: true,
        type: true,
        practiceLocationId: true,
        serviceDate: true,
        reversesQueueEventId: true,
        newPrimaryStatus: true,
        newSecondaryStatus: true,
        appointmentLinks: {
          select: { role: true, appointmentId: true },
        },
      },
    });
    if (
      !event ||
      event.type !== QueueEventType.UNDO ||
      event.practiceLocationId !== practiceLocationId ||
      event.serviceDate.getTime() !== serviceDate.getTime() ||
      !event.reversesQueueEventId
    ) {
      throw new ConflictException('UNDO replay result is inconsistent.');
    }
    const primary = event.appointmentLinks.find(
      (link) => link.role === QueueEventAppointmentLinkRole.PRIMARY,
    );
    const secondary = event.appointmentLinks.find(
      (link) => link.role === QueueEventAppointmentLinkRole.SECONDARY,
    );
    if (
      !primary ||
      !secondary ||
      !event.newPrimaryStatus ||
      !event.newSecondaryStatus
    ) {
      throw new ConflictException('UNDO replay result is incomplete.');
    }
    return {
      replayed: true,
      queueEventId: event.id,
      reversedQueueEventId: event.reversesQueueEventId,
      restoredPrimaryAppointmentId: primary.appointmentId,
      restoredPrimaryStatus: event.newPrimaryStatus,
      restoredSecondaryAppointmentId: secondary.appointmentId,
      restoredSecondaryStatus: event.newSecondaryStatus,
    };
  }

  private async lockAppointment(
    transaction: TransactionClient,
    appointmentId: string,
    practiceLocationId: string,
    serviceDate: Date,
  ): Promise<LockedAppointment> {
    const rows = await transaction.$queryRaw<LockedAppointment[]>(Prisma.sql`
      SELECT
        "id",
        "bookingGroupId",
        "practiceLocationId",
        "serviceDate",
        "mobileNumberHash",
        "anonymizedAt",
        "status",
        "servingOrderKey",
        "waitingPlacementType",
        "activeAppointmentKey",
        "calledAt",
        "completedAt",
        "terminalAt"
      FROM "Appointment"
      WHERE "id" = ${appointmentId}
        AND "practiceLocationId" = ${practiceLocationId}
        AND "serviceDate" = ${serviceDate}
      LIMIT 1
      FOR UPDATE
    `);
    const appointment = rows[0];
    if (!appointment) {
      throw new ConflictException('UNDO Appointment state is unavailable.');
    }
    return appointment;
  }

  private assertCurrentStateMatchesEvent(
    primary: LockedAppointment,
    secondary: LockedAppointment,
    original: {
      newPrimaryStatus: AppointmentStatus | null;
      newSecondaryStatus: AppointmentStatus | null;
      newPrimaryOrderKey: Prisma.Decimal | null;
      newSecondaryOrderKey: Prisma.Decimal | null;
      newPrimaryWaitingPlacementType: string | null;
      newSecondaryWaitingPlacementType: string | null;
      newPrimaryTerminalAt: Date | null;
      newSecondaryTerminalAt: Date | null;
    },
  ): void {
    if (
      primary.anonymizedAt ||
      secondary.anonymizedAt ||
      primary.status !== original.newPrimaryStatus ||
      secondary.status !== original.newSecondaryStatus ||
      !this.decimalEquals(
        primary.servingOrderKey,
        original.newPrimaryOrderKey,
      ) ||
      !this.decimalEquals(
        secondary.servingOrderKey,
        original.newSecondaryOrderKey,
      ) ||
      primary.waitingPlacementType !==
        original.newPrimaryWaitingPlacementType ||
      secondary.waitingPlacementType !==
        original.newSecondaryWaitingPlacementType ||
      !this.dateEquals(primary.terminalAt, original.newPrimaryTerminalAt) ||
      !this.dateEquals(secondary.terminalAt, original.newSecondaryTerminalAt)
    ) {
      throw new ConflictException(
        'UNDO is no longer safe for the current queue state.',
      );
    }
  }

  private async restorePrimaryActiveKey(
    transaction: TransactionClient,
    primary: LockedAppointment,
    restoredStatus: AppointmentStatus,
  ): Promise<string | null> {
    const activeStatuses: AppointmentStatus[] = [
      AppointmentStatus.WAITING,
      AppointmentStatus.CALLED,
      AppointmentStatus.TEMPORARILY_ABSENT,
      AppointmentStatus.OUT_FOR_PROCEDURE,
    ];
    const active = activeStatuses.includes(restoredStatus);
    if (!active) return null;
    if (primary.activeAppointmentKey) return primary.activeAppointmentKey;
    if (!primary.mobileNumberHash) {
      throw new ConflictException(
        'UNDO cannot restore active booking identity.',
      );
    }
    const activeAppointmentKey = createHash('sha256')
      .update(
        `ACTIVE_APPOINTMENT|${primary.mobileNumberHash}|${primary.practiceLocationId}|${primary.serviceDate.toISOString().slice(0, 10)}`,
        'utf8',
      )
      .digest('hex');
    const conflict = await transaction.appointment.findFirst({
      where: {
        activeAppointmentKey,
        id: { not: primary.id },
      },
      select: { id: true },
    });
    if (conflict) {
      throw new ConflictException(
        'UNDO cannot restore active booking identity.',
      );
    }
    return activeAppointmentKey;
  }

  private readMetadata(value: Prisma.JsonValue | null): EventMetadata {
    if (!value || Array.isArray(value) || typeof value !== 'object') return {};
    return value;
  }

  private readDate(value: unknown): Date | null {
    if (typeof value !== 'string') return null;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  private decimalEquals(
    left: Prisma.Decimal | null,
    right: Prisma.Decimal | null,
  ): boolean {
    if (!left || !right) return left === right;
    return left.equals(right);
  }

  private dateEquals(left: Date | null, right: Date | null): boolean {
    return left?.getTime() === right?.getTime();
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
        'Regular Clinic Secretary requires QUEUE_AND_CLINIC_DAY_OPERATIONS authority.',
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
