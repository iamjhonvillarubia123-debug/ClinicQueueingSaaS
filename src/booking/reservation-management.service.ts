import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CommandType, Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CommandIdempotencyService } from '../idempotency/command-idempotency.service';
import { PatientBookingAccessService } from '../patient-access/patient-booking-access.service';
import { PatientBookingGroupAccessService } from '../patient-access/patient-booking-group-access.service';
import { PublicServiceDateAvailabilityService } from '../schedule/public-service-date-availability.service';
import { claimTimeSlotReservations } from '../schedule/time-slot-reservations';
import { NotificationPayloadService } from '../notification/notification-payload.service';

type Principal =
  | { userId: string }
  | { token: string; bookingReference: string; bookingGroupId?: string };
type Action = 'RESCHEDULE' | 'CANCEL' | 'START_SERVICE';

@Injectable()
export class ReservationManagementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly idempotency: CommandIdempotencyService,
    private readonly patientAccess: PatientBookingAccessService,
    private readonly groupAccess: PatientBookingGroupAccessService,
    private readonly availability: PublicServiceDateAvailabilityService,
    private readonly notifications: NotificationPayloadService,
  ) {}

  async execute(
    principal: Principal,
    appointmentIdOrReference: string,
    action: Action,
    rawKey: string | undefined,
    reservationAt?: string,
    confirmOverride = false,
  ) {
    const key = this.idempotency.normalizeKey(rawKey);
    const commandType =
      action === 'RESCHEDULE'
        ? CommandType.RESCHEDULE_APPOINTMENT
        : action === 'START_SERVICE'
          ? CommandType.START_APPOINTMENT_SERVICE
          : CommandType.PATIENT_CANCEL_APPOINTMENT;
    return this.prisma.$transaction(async (db) => {
      const staff = 'userId' in principal;
      if (!staff) {
        if (principal.bookingGroupId)
          await this.groupAccess.validateControllerToken(
            db,
            principal.token,
            principal.bookingGroupId,
          );
        else
          await this.patientAccess.validateManagementToken(
            db,
            principal.token,
            principal.bookingReference,
          );
      }
      const initial = await db.appointment.findUnique({
        where: staff
          ? { id: appointmentIdOrReference }
          : { bookingReference: principal.bookingReference },
        include: { practiceLocation: { select: { doctorProfileId: true } } },
      });
      if (!initial) throw new NotFoundException('Appointment not found.');
      if (
        !staff &&
        principal.bookingGroupId &&
        initial.bookingGroupId !== principal.bookingGroupId
      )
        throw new ForbiddenException(
          'Appointment is outside this booking group.',
        );
      const identity = this.idempotency.deriveIdentity({
        idempotencyKey: key,
        commandType,
        scope: {
          appointmentId: initial.id,
          actorUserId: staff ? principal.userId : null,
        },
      });
      const fingerprint = this.idempotency.fingerprint({
        action,
        reservationAt: reservationAt ?? null,
        confirmOverride,
      });
      await this.idempotency.acquireCommandLock(db, identity);
      const dateKey = initial.serviceDate.toISOString().slice(0, 10);
      await db.$executeRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`queue|${initial.practiceLocationId}|${dateKey}`},0))`,
      );
      await db.$queryRaw(
        Prisma.sql`SELECT id FROM "PracticeLocation" WHERE id=${initial.practiceLocationId} FOR UPDATE`,
      );
      await db.$executeRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`DOCTOR_SCHEDULE|${initial.practiceLocation.doctorProfileId}`},0))`,
      );
      await db.$executeRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`BOOKING_CAPACITY:${initial.practiceLocationId}:${dateKey}`},0))`,
      );
      await db.$queryRaw(
        Prisma.sql`SELECT id FROM "Appointment" WHERE id=${initial.id} FOR UPDATE`,
      );
      const appointment = await db.appointment.findUniqueOrThrow({
        where: { id: initial.id },
        include: {
          practiceLocation: {
            include: {
              doctorProfile: { include: { user: true } },
              currentRegularPracticeStaff: true,
            },
          },
          bookedServices: true,
          bookingGroup: { select: { controllingMobileNumberEncrypted: true } },
        },
      });
      const day = await db.clinicDay.findUnique({
        where: {
          practiceLocationId_serviceDate: {
            practiceLocationId: appointment.practiceLocationId,
            serviceDate: appointment.serviceDate,
          },
        },
        include: { operatingPracticeStaff: true },
      });
      let secretary = false;
      if (staff) {
        if (appointment.practiceLocation.lifecycleStatus !== 'ACTIVE')
          throw new ConflictException('Practice location is not operational.');
        await db.$queryRaw(
          Prisma.sql`SELECT id FROM "User" WHERE id=${principal.userId} FOR UPDATE`,
        );
        const actor = await db.user.findUnique({
          where: { id: principal.userId },
        });
        if (
          actor?.accountStatus !== 'ACTIVE' ||
          actor.administrativeRestrictionStatus !== 'NONE'
        )
          throw new ForbiddenException('Eligible clinic staff is required.');
        if (
          appointment.practiceLocation.doctorProfile.userId !== principal.userId
        ) {
          const assignment = day?.operatingPracticeStaff;
          if (
            !assignment?.isActive ||
            assignment.userId !== principal.userId ||
            day?.status !== 'STARTED'
          )
            throw new ForbiddenException(
              'Current operating Secretary authority is required.',
            );
          secretary = true;
          if (
            assignment.id ===
            appointment.practiceLocation.currentRegularPracticeStaffId
          ) {
            const grant = await db.practiceStaffAuthorityBundle.findFirst({
              where: {
                practiceStaffId: assignment.id,
                status: 'ACTIVE',
                bundleType:
                  action === 'START_SERVICE'
                    ? 'QUEUE_AND_CLINIC_DAY_OPERATIONS'
                    : 'APPOINTMENTS_AND_PATIENT_INTAKE',
              },
            });
            if (!grant)
              throw new ForbiddenException(
                'Required Secretary authority is missing.',
              );
          }
        }
      } else {
        const doctor = appointment.practiceLocation.doctorProfile.user;
        if (
          doctor.accountStatus !== 'ACTIVE' ||
          doctor.administrativeRestrictionStatus !== 'NONE' ||
          appointment.practiceLocation.lifecycleStatus !== 'ACTIVE'
        )
          throw new ConflictException(
            'Online appointment management is unavailable.',
          );
        if (action === 'START_SERVICE')
          throw new ForbiddenException('Only clinic staff may start service.');
        const financial = await db.doctorFinancialAccount.findUnique({
          where: { doctorUserId: doctor.id },
          include: { entitlement: true },
        });
        if (
          !financial?.entitlement?.graceEndsAt ||
          financial.entitlement.graceEndsAt.getTime() <= Date.now()
        )
          throw new ConflictException(
            'Online appointment management is unavailable.',
          );
      }
      const replay = await this.idempotency.findReplay(
        db,
        identity,
        fingerprint,
      );
      if (replay)
        return { appointment: this.publicResult(appointment), replayed: true };
      if (
        appointment.appointmentMode !== 'TIME_SLOT_MODE' ||
        !appointment.reservationAt
      )
        throw new ConflictException(
          'This operation requires a Time-Slot appointment.',
        );
      if (
        appointment.anonymizedAt ||
        appointment.terminalAt ||
        ![
          'WAITING',
          'TEMPORARILY_ABSENT',
          'CALLED',
          'OUT_FOR_PROCEDURE',
        ].includes(appointment.status)
      )
        throw new ConflictException('This Appointment is no longer eligible.');
      if (day?.status === 'CLOSED' || day?.status === 'CANCELLED')
        throw new ConflictException('The clinic day is no longer operational.');
      if (action !== 'START_SERVICE' && appointment.serviceStartedAt)
        throw new ConflictException(
          'Reservation recovery stops after active service begins.',
        );
      const now = new Date();
      let change: Prisma.AppointmentUpdateInput;
      let override = false;
      if (action === 'START_SERVICE') {
        if (day?.status !== 'STARTED' || appointment.status !== 'CALLED')
          throw new ConflictException(
            'Only the currently called patient may begin service.',
          );
        change = { serviceStartedAt: appointment.serviceStartedAt ?? now };
      } else if (action === 'CANCEL') {
        change = {
          status: 'CANCELLED',
          cancelledAt: now,
          terminalAt: now,
          cancelledByType: staff
            ? secretary
              ? 'SECRETARY'
              : 'DOCTOR'
            : 'PATIENT',
          activeAppointmentKey: null,
          servingOrderKey: null,
          waitingPlacementType: null,
        };
      } else {
        if (
          !reservationAt ||
          !Number.isFinite(new Date(reservationAt).getTime())
        )
          throw new ConflictException('A valid Reservation Time is required.');
        if (
          secretary &&
          new Date(reservationAt).getTime() + 30 * 60000 <= now.getTime()
        )
          throw new ForbiddenException(
            'A Secretary cannot assign an expired Reservation Time.',
          );
        if (!staff) {
          const eligibility = await this.availability.resolve(
            appointment.practiceLocationId,
            dateKey,
            now,
            db,
          );
          if (!eligibility.availableForPublicBooking)
            throw new ConflictException(
              'Self-rescheduling is unavailable. Your appointment remains unchanged; contact the clinic.',
            );
        }
        const actualMinutes =
          appointment.bookedServices.reduce(
            (sum, s) => sum + s.durationMinutesSnapshot,
            0,
          ) || appointment.estimatedServiceMinutes;
        const [claim] = await claimTimeSlotReservations(db, this.availability, {
          practiceLocationId: appointment.practiceLocationId,
          serviceDate: appointment.serviceDate,
          members: [{ reservationAt: new Date(reservationAt), actualMinutes }],
          staff,
          confirmOverride,
          groupMember: !!appointment.bookingGroupId,
          excludeAppointmentIds: [appointment.id],
          now,
        });
        override = claim.availabilityOverride;
        change = {
          reservationAt: claim.reservationAt,
          schedulingAllotmentMinutes: claim.schedulingAllotmentMinutes,
          status: 'WAITING',
          calledAt: null,
          waitingPlacementType: 'ORDINARY',
          servingOrderKey: new Prisma.Decimal(
            claim.reservationAt.getTime(),
          ).plus(new Prisma.Decimal(appointment.queueNumber).div(1000000)),
        };
      }
      const updated = await db.appointment.update({
        where: { id: appointment.id },
        data: change,
      });
      if (action === 'RESCHEDULE' && appointment.bookingGroupId)
        await db.bookingGroup.update({
          where: { id: appointment.bookingGroupId },
          data: { servingProtectionEndedAt: now },
        });
      await db.appointmentReservationEvent.create({
        data: {
          appointmentId: appointment.id,
          actorUserId: staff ? principal.userId : null,
          actorType: staff ? 'USER' : 'PATIENT',
          action,
          previousReservationAt: appointment.reservationAt,
          reservationAt: updated.reservationAt!,
          availabilityOverride: override,
          details: {
            previousStatus: appointment.status,
            status: updated.status,
            previousServingOrder:
              appointment.servingOrderKey?.toString() ?? null,
            servingOrder: updated.servingOrderKey?.toString() ?? null,
          },
        },
      });
      const times = this.idempotency.completionTimes(now);
      const command = await db.commandIdempotency.create({
        data: {
          idempotencyKey: key,
          commandIdentityKey: identity,
          commandType,
          requestFingerprint: fingerprint,
          actorUserId: staff ? principal.userId : null,
          practiceLocationId: appointment.practiceLocationId,
          serviceDate: appointment.serviceDate,
          appointmentId: appointment.id,
          resultAppointmentId: appointment.id,
          createdAt: now,
          ...times,
        },
      });
      const recipient =
        appointment.mobileNumberEncrypted ??
        appointment.bookingGroup?.controllingMobileNumberEncrypted;
      if (action !== 'START_SERVICE' && recipient) {
        await db.notificationOutbox.create({
          data: {
            deliveryIdentityKey: this.idempotency.fingerprint({
              notification: 'reservation',
              identity,
            }),
            channel: 'SMS',
            notificationType:
              action === 'CANCEL'
                ? 'APPOINTMENT_CANCELLATION'
                : 'BOOKING_CONFIRMATION',
            status: 'PENDING',
            practiceLocationId: appointment.practiceLocationId,
            appointmentId: appointment.id,
            commandIdempotencyId: command.id,
            recipientMobileEncrypted: recipient,
            messageBodyEncrypted: this.notifications.encryptMessage(
              action === 'CANCEL'
                ? `Appointment ${appointment.bookingReference} has been cancelled.`
                : `Appointment ${appointment.bookingReference} reservation changed to ${updated.reservationAt!.toISOString()}. Queue number ${appointment.queueNumber} is unchanged.`,
            ),
            providerIdempotencyKey: `reservation:${identity}`,
            nextAttemptAt: now,
            expiresAt: new Date(now.getTime() + 30 * 86400000),
            createdAt: now,
          },
        });
      }
      return { appointment: this.publicResult(updated), replayed: false };
    });
  }

  private publicResult(a: {
    bookingReference: string;
    queueNumber: number;
    appointmentMode: string;
    reservationAt: Date | null;
    status: string;
    serviceStartedAt: Date | null;
  }) {
    return {
      bookingReference: a.bookingReference,
      queueNumber: a.queueNumber,
      appointmentMode: a.appointmentMode,
      reservationAt: a.reservationAt,
      status: a.status,
      serviceStartedAt: a.serviceStartedAt,
    };
  }
}
