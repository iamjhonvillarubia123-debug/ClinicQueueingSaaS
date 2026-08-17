import { ConflictException, Injectable } from '@nestjs/common';
import {
  AppointmentStatus,
  ClinicDayStatus,
  CommandType,
  PracticeLocationLifecycleStatus,
  Prisma,
  QueueEventActorType,
  QueueEventAppointmentLinkRole,
  QueueEventType,
  WaitingPlacementType,
} from '../../generated/prisma/client';
import { CommandIdempotencyService } from '../idempotency/command-idempotency.service';
import { PatientBookingAccessService } from '../patient-access/patient-booking-access.service';
import { PrismaService } from '../prisma/prisma.service';
import { QueueServingOrderPlacementService } from './queue-serving-order-placement.service';

type TransactionClient = Prisma.TransactionClient;

type TargetAppointment = {
  id: string;
  bookingReference: string;
  practiceLocationId: string;
  serviceDate: Date;
  bookingGroupId: string | null;
  status: AppointmentStatus;
  servingOrderKey: Prisma.Decimal | null;
  waitingPlacementType: WaitingPlacementType | null;
  selfServiceReinsertedAt: Date | null;
  anonymizedAt: Date | null;
  queueNumber: number;
};

@Injectable()
export class ImHereService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly idempotency: CommandIdempotencyService,
    private readonly patientBookingAccess: PatientBookingAccessService,
    private readonly placement: QueueServingOrderPlacementService,
  ) {}

  async reinsert(
    bookingReference: string,
    rawToken: string,
    idempotencyKey: string | undefined,
  ) {
    const key = this.idempotency.normalizeKey(idempotencyKey);

    return this.prisma.$transaction(async (transaction) => {
      const access = await this.patientBookingAccess.validateManagementToken(
        transaction,
        rawToken,
        bookingReference,
      );
      const appointment = access.appointment;
      const commandType = CommandType.SELF_SERVICE_REINSERTION;
      const identityScope = { appointmentId: appointment.id };
      const commandIdentityKey = this.idempotency.deriveIdentity({
        idempotencyKey: key,
        commandType,
        scope: identityScope,
      });
      const requestFingerprint = this.idempotency.fingerprint({});

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
        return this.readReplayResult(
          transaction,
          replay.resultQueueEventId,
          appointment.id,
        );
      }

      await this.acquireQueueScopeLock(
        transaction,
        appointment.practiceLocationId,
        appointment.serviceDate,
      );
      const target = await this.lockTargetAppointment(
        transaction,
        appointment.id,
      );
      this.assertTargetMatchesAccess(target, bookingReference);
      await this.assertOperationalQueue(transaction, target);
      this.assertEligibleTarget(target);

      const servingOrderKey = await this.placement.calculateImHerePlacement(
        transaction,
        target.practiceLocationId,
        target.serviceDate,
      );
      const now = new Date();

      await transaction.appointment.update({
        where: { id: target.id },
        data: {
          status: AppointmentStatus.WAITING,
          servingOrderKey,
          waitingPlacementType: WaitingPlacementType.IM_HERE,
          selfServiceReinsertedAt: now,
        },
      });

      const queueEventSequence = await this.nextQueueEventSequence(
        transaction,
        target.practiceLocationId,
        target.serviceDate,
      );
      const queueEvent = await transaction.queueEvent.create({
        data: {
          practiceLocationId: target.practiceLocationId,
          serviceDate: target.serviceDate,
          queueEventSequence,
          type: QueueEventType.SELF_SERVICE_REINSERTION,
          actorType: QueueEventActorType.PATIENT,
          actorUserId: null,
          previousPrimaryStatus: target.status,
          newPrimaryStatus: AppointmentStatus.WAITING,
          previousPrimaryOrderKey: target.servingOrderKey,
          newPrimaryOrderKey: servingOrderKey,
          previousPrimaryWaitingPlacementType: target.waitingPlacementType,
          newPrimaryWaitingPlacementType: WaitingPlacementType.IM_HERE,
          previousPrimarySelfServiceReinsertedAt:
            target.selfServiceReinsertedAt,
          newPrimarySelfServiceReinsertedAt: now,
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
          practiceLocationId: target.practiceLocationId,
          serviceDate: target.serviceDate,
          appointmentId: target.id,
          resultAppointmentId: target.id,
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
        bookingReference: target.bookingReference,
        queueNumber: target.queueNumber,
        status: AppointmentStatus.WAITING,
        waitingPlacementType: WaitingPlacementType.IM_HERE,
        servingOrderKey: servingOrderKey.toString(),
        selfServiceReinsertedAt: now,
      };
    });
  }

  private async readReplayResult(
    transaction: TransactionClient,
    queueEventId: string | null,
    appointmentId: string,
  ) {
    if (!queueEventId) {
      throw new ConflictException("I'M HERE replay record is incomplete.");
    }
    const event = await transaction.queueEvent.findUnique({
      where: { id: queueEventId },
      select: {
        id: true,
        type: true,
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
      event.type !== QueueEventType.SELF_SERVICE_REINSERTION ||
      !primary ||
      primary.appointmentId !== appointmentId
    ) {
      throw new ConflictException("I'M HERE replay result is inconsistent.");
    }
    const appointment = await transaction.appointment.findUnique({
      where: { id: appointmentId },
      select: {
        id: true,
        bookingReference: true,
        queueNumber: true,
        status: true,
        waitingPlacementType: true,
        servingOrderKey: true,
        selfServiceReinsertedAt: true,
      },
    });
    if (!appointment) {
      throw new ConflictException(
        "I'M HERE replay Appointment is unavailable.",
      );
    }
    return {
      replayed: true,
      queueEventId: event.id,
      appointmentId: appointment.id,
      bookingReference: appointment.bookingReference,
      queueNumber: appointment.queueNumber,
      status: appointment.status,
      waitingPlacementType: appointment.waitingPlacementType,
      servingOrderKey: appointment.servingOrderKey?.toString() ?? null,
      selfServiceReinsertedAt: appointment.selfServiceReinsertedAt,
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

  private async lockTargetAppointment(
    transaction: TransactionClient,
    appointmentId: string,
  ): Promise<TargetAppointment> {
    const rows = await transaction.$queryRaw<TargetAppointment[]>(Prisma.sql`
      SELECT
        "id",
        "bookingReference",
        "practiceLocationId",
        "serviceDate",
        "bookingGroupId",
        "status",
        "servingOrderKey",
        "waitingPlacementType",
        "selfServiceReinsertedAt",
        "anonymizedAt",
        "queueNumber"
      FROM "Appointment"
      WHERE "id" = ${appointmentId}
      LIMIT 1
      FOR UPDATE
    `);
    const target = rows[0];
    if (!target) {
      throw new ConflictException("I'M HERE is unavailable for this booking.");
    }
    return target;
  }

  private assertTargetMatchesAccess(
    target: TargetAppointment,
    bookingReference: string,
  ): void {
    if (target.bookingReference !== bookingReference || target.anonymizedAt) {
      throw new ConflictException("I'M HERE is unavailable for this booking.");
    }
  }

  private async assertOperationalQueue(
    transaction: TransactionClient,
    target: TargetAppointment,
  ): Promise<void> {
    const [location, clinicDay] = await Promise.all([
      transaction.practiceLocation.findUnique({
        where: { id: target.practiceLocationId },
        select: { lifecycleStatus: true },
      }),
      transaction.clinicDay.findUnique({
        where: {
          practiceLocationId_serviceDate: {
            practiceLocationId: target.practiceLocationId,
            serviceDate: target.serviceDate,
          },
        },
        select: { status: true },
      }),
    ]);
    if (
      !location ||
      location.lifecycleStatus !== PracticeLocationLifecycleStatus.ACTIVE ||
      !clinicDay ||
      clinicDay.status !== ClinicDayStatus.STARTED
    ) {
      throw new ConflictException("I'M HERE requires an active clinic queue.");
    }
  }

  private assertEligibleTarget(target: TargetAppointment): void {
    if (
      target.bookingGroupId !== null ||
      target.status !== AppointmentStatus.TEMPORARILY_ABSENT ||
      target.selfServiceReinsertedAt !== null ||
      target.servingOrderKey !== null ||
      target.waitingPlacementType !== null
    ) {
      throw new ConflictException("I'M HERE is unavailable for this booking.");
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
