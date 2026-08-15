import { createHash } from 'crypto';
import { Injectable } from '@nestjs/common';
import {
  AppointmentCancelledByType,
  AppointmentStatus,
  ClinicDayCancellationReason,
  ClinicDayStatus,
  NotificationChannel,
  NotificationOutboxStatus,
  NotificationType,
  Prisma,
  QueueEventActorType,
  QueueEventAppointmentLinkRole,
  QueueEventType,
  WaitingPlacementType,
} from '../../generated/prisma/client';
import { NotificationPayloadService } from '../notification/notification-payload.service';

const OUTBOX_PROVISIONAL_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

type TransactionClient = Prisma.TransactionClient;

type CandidateClinicDay = {
  id: string;
  practiceLocationId: string;
  serviceDate: Date;
  status: ClinicDayStatus;
};

type CancellableAppointment = {
  id: string;
  status: AppointmentStatus;
  servingOrderKey: Prisma.Decimal | null;
  waitingPlacementType: WaitingPlacementType | null;
  terminalAt: Date | null;
  mobileNumberEncrypted: string | null;
  allowOperationalMessages: boolean;
};

@Injectable()
export class ClinicDayCancellationService {
  constructor(
    private readonly notificationPayloadService: NotificationPayloadService,
  ) {}

  async cancelDoctorOperationsForEmergency(
    transaction: TransactionClient,
    doctorUserId: string,
    actorUserId: string,
    administrativeAccountActionId: string,
    now: Date,
  ): Promise<{ stoppedClinicDayCount: number }> {
    const candidates = await transaction.$queryRaw<CandidateClinicDay[]>(
      Prisma.sql`
        SELECT
          cd."id",
          cd."practiceLocationId",
          cd."serviceDate",
          cd."status"
        FROM "ClinicDay" cd
        INNER JOIN "PracticeLocation" pl
          ON pl."id" = cd."practiceLocationId"
        INNER JOIN "DoctorProfile" dp
          ON dp."id" = pl."doctorProfileId"
        WHERE dp."userId" = ${doctorUserId}
          AND cd."status" IN (
            'NOT_STARTED'::"ClinicDayStatus",
            'DELAYED'::"ClinicDayStatus",
            'STARTED'::"ClinicDayStatus"
          )
        ORDER BY cd."practiceLocationId", cd."serviceDate", cd."id"
      `,
    );

    let stoppedClinicDayCount = 0;

    for (const candidate of candidates) {
      await this.acquireQueueScopeLock(
        transaction,
        candidate.practiceLocationId,
        candidate.serviceDate,
      );

      const lockedRows = await transaction.$queryRaw<CandidateClinicDay[]>(
        Prisma.sql`
          SELECT
            cd."id",
            cd."practiceLocationId",
            cd."serviceDate",
            cd."status"
          FROM "ClinicDay" cd
          INNER JOIN "PracticeLocation" pl
            ON pl."id" = cd."practiceLocationId"
          INNER JOIN "DoctorProfile" dp
            ON dp."id" = pl."doctorProfileId"
          WHERE cd."id" = ${candidate.id}
            AND dp."userId" = ${doctorUserId}
          LIMIT 1
          FOR UPDATE OF cd
        `,
      );
      const clinicDay = lockedRows[0];
      if (!clinicDay || !this.isCancellableClinicDay(clinicDay.status)) {
        continue;
      }

      const appointments = await transaction.$queryRaw<CancellableAppointment[]>(
        Prisma.sql`
          SELECT
            a."id",
            a."status",
            a."servingOrderKey",
            a."waitingPlacementType",
            a."terminalAt",
            a."mobileNumberEncrypted",
            COALESCE(cp."allowOperationalMessages", TRUE) AS "allowOperationalMessages"
          FROM "Appointment" a
          LEFT JOIN "ContactPreference" cp
            ON cp."appointmentId" = a."id"
          WHERE a."practiceLocationId" = ${clinicDay.practiceLocationId}
            AND a."serviceDate" = ${clinicDay.serviceDate}
            AND a."status" IN (
              'WAITING'::"AppointmentStatus",
              'CALLED'::"AppointmentStatus",
              'TEMPORARILY_ABSENT'::"AppointmentStatus",
              'OUT_FOR_PROCEDURE'::"AppointmentStatus"
            )
          ORDER BY a."id"
          FOR UPDATE OF a
        `,
      );

      let nextSequence = await this.nextQueueEventSequence(
        transaction,
        clinicDay.practiceLocationId,
        clinicDay.serviceDate,
      );

      for (const appointment of appointments) {
        await transaction.appointment.update({
          where: { id: appointment.id },
          data: {
            status: AppointmentStatus.CANCELLED,
            servingOrderKey: null,
            waitingPlacementType: null,
            cancelledAt: now,
            terminalAt: now,
            cancelledByType: AppointmentCancelledByType.SYSTEM,
            cancellationReason:
              'Clinic operations stopped by emergency administrative action.',
          },
        });

        const queueEvent = await transaction.queueEvent.create({
          data: {
            practiceLocationId: clinicDay.practiceLocationId,
            serviceDate: clinicDay.serviceDate,
            queueEventSequence: nextSequence,
            type: QueueEventType.APPOINTMENT_CANCELLED,
            actorType: QueueEventActorType.USER,
            actorUserId,
            previousPrimaryStatus: appointment.status,
            newPrimaryStatus: AppointmentStatus.CANCELLED,
            previousPrimaryOrderKey: appointment.servingOrderKey,
            newPrimaryOrderKey: null,
            previousPrimaryWaitingPlacementType:
              appointment.waitingPlacementType,
            newPrimaryWaitingPlacementType: null,
            previousPrimaryTerminalAt: appointment.terminalAt,
            newPrimaryTerminalAt: now,
            metadata: {
              source: 'SYSTEM_ADMIN_EMERGENCY_SUSPENSION',
            },
          },
          select: { id: true },
        });

        await transaction.queueEventAppointmentLink.create({
          data: {
            queueEventId: queueEvent.id,
            role: QueueEventAppointmentLinkRole.PRIMARY,
            appointmentId: appointment.id,
          },
        });

        if (
          appointment.mobileNumberEncrypted &&
          appointment.allowOperationalMessages
        ) {
          const message =
            'Your clinic appointment has been cancelled because clinic operations were stopped. Please contact the clinic to arrange a new appointment.';
          await transaction.notificationOutbox.create({
            data: {
              deliveryIdentityKey: this.hash(
                `${NotificationType.CLINIC_DAY_CANCELLATION}|${administrativeAccountActionId}|${appointment.id}`,
              ),
              notificationType: NotificationType.CLINIC_DAY_CANCELLATION,
              channel: NotificationChannel.SMS,
              status: NotificationOutboxStatus.PENDING,
              practiceLocationId: clinicDay.practiceLocationId,
              appointmentId: appointment.id,
              administrativeAccountActionId,
              recipientMobileEncrypted: appointment.mobileNumberEncrypted,
              recipientEmailEncrypted: null,
              messageBodyEncrypted:
                this.notificationPayloadService.encryptMessage(message),
              providerIdempotencyKey: `emergency-clinic-cancel:${administrativeAccountActionId}:${appointment.id}`,
              attemptCount: 0,
              nextAttemptAt: now,
              expiresAt: new Date(
                now.getTime() + OUTBOX_PROVISIONAL_RETENTION_MS,
              ),
              createdAt: now,
            },
          });
        }

        nextSequence += 1n;
      }

      await transaction.clinicDay.update({
        where: { id: clinicDay.id },
        data: {
          status: ClinicDayStatus.CANCELLED,
          cancelledAt: now,
          cancelledByUserId: actorUserId,
          cancellationReason: ClinicDayCancellationReason.OTHER,
          cancellationNote:
            'Clinic operations stopped by SYSTEM_ADMIN emergency suspension.',
        },
      });

      await transaction.administrativeAccountActionScope.create({
        data: {
          administrativeAccountActionId,
          practiceLocationId: clinicDay.practiceLocationId,
          clinicDayId: clinicDay.id,
        },
      });

      stoppedClinicDayCount += 1;
    }

    return { stoppedClinicDayCount };
  }

  private isCancellableClinicDay(status: ClinicDayStatus): boolean {
    return (
      status === ClinicDayStatus.NOT_STARTED ||
      status === ClinicDayStatus.DELAYED ||
      status === ClinicDayStatus.STARTED
    );
  }

  private async acquireQueueScopeLock(
    transaction: TransactionClient,
    practiceLocationId: string,
    serviceDate: Date,
  ): Promise<void> {
    const lockIdentity = `queue|${practiceLocationId}|${this.dateKey(serviceDate)}`;
    await transaction.$executeRaw`
      SELECT pg_advisory_xact_lock(hashtextextended(${lockIdentity}, 0))
    `;
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

  private dateKey(value: Date): string {
    return value.toISOString().slice(0, 10);
  }

  private hash(value: string): string {
    return createHash('sha256').update(value, 'utf8').digest('hex');
  }
}
