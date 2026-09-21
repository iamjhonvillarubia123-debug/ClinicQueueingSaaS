import { ConflictException } from '@nestjs/common';
import { AppointmentMode, Prisma } from '../../generated/prisma/client';
import { resolveAppointmentMode } from './appointment-mode.configuration';
import { PublicServiceDateAvailabilityService } from './public-service-date-availability.service';
import { ScheduleTimeService } from './schedule-time.service';
import {
  SlotCalendar,
  TimeSlotAvailabilityPolicy,
} from './time-slot-availability.policy';

export type ReservationRequest = {
  practiceLocationId: string;
  serviceDate: Date;
  members: { reservationAt: Date | null; actualMinutes: number }[];
  fragmented?: boolean;
  staff?: boolean;
  groupMember?: boolean;
  confirmOverride?: boolean;
  excludeAppointmentIds?: string[];
  now?: Date;
};

export function localMinute(at: Date, zone: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: zone,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  return (
    Number(parts.find((p) => p.type === 'hour')?.value) * 60 +
    Number(parts.find((p) => p.type === 'minute')?.value) +
    Number(parts.find((p) => p.type === 'second')?.value) / 60
  );
}

export async function loadTimeSlotCalendar(
  db: Prisma.TransactionClient,
  availability: PublicServiceDateAvailabilityService,
  practiceLocationId: string,
  serviceDate: Date,
  now = new Date(),
  excludeAppointmentIds: string[] = [],
) {
  const configuration = await resolveAppointmentMode(
    db,
    practiceLocationId,
    serviceDate,
  );
  const location = await db.practiceLocation.findUniqueOrThrow({
    where: { id: practiceLocationId },
    select: { timeZone: true },
  });
  if (!location.timeZone)
    throw new ConflictException('Clinic timezone is required.');
  const zone = location.timeZone;
  const dateKey = serviceDate.toISOString().slice(0, 10);
  const schedule = await availability.resolveCapacitySchedule(
    practiceLocationId,
    dateKey,
    db,
  );
  if (!schedule.opensAt || !schedule.closesAt)
    throw new ConflictException('No open schedule for this Service Date.');
  const reservations = await db.appointment.findMany({
    where: {
      practiceLocationId,
      serviceDate,
      appointmentMode: AppointmentMode.TIME_SLOT_MODE,
      status: { notIn: ['CANCELLED', 'RESCHEDULED'] },
      id: { notIn: excludeAppointmentIds },
    },
    select: {
      reservationAt: true,
      schedulingAllotmentMinutes: true,
      estimatedServiceMinutes: true,
    },
  });
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  const calendar: SlotCalendar = {
    opens: localMinute(schedule.opensAt, zone),
    closes: localMinute(schedule.closesAt, zone),
    maximumOperatingUntil: localMinute(
      schedule.maximumOperatingUntilAt ?? schedule.closesAt,
      zone,
    ),
    notBefore:
      dateKey < today
        ? Infinity
        : dateKey === today
          ? localMinute(now, zone)
          : 0,
    protectedPeriods: configuration.protectedPeriods
      .filter((p) => p.weekday === serviceDate.getUTCDay())
      .map((p) => ({ start: p.startMinute, end: p.endMinute })),
    reservations: reservations
      .filter((r) => r.reservationAt !== null)
      .map((r) => ({
        start: localMinute(r.reservationAt!, zone),
        minutes: r.schedulingAllotmentMinutes ?? r.estimatedServiceMinutes,
      })),
  };
  const time = new ScheduleTimeService();
  const toInstant = (minute: number) =>
    time.localDateTimeToInstant(
      time.parseServiceDate(dateKey),
      { hour: Math.floor(minute / 60), minute: minute % 60, second: 0 },
      zone,
    );
  return { configuration, calendar, zone, toInstant };
}

/** Must be called inside the same transaction as creation/update. No provisional holds. */
export async function claimTimeSlotReservations(
  db: Prisma.TransactionClient,
  availability: PublicServiceDateAvailabilityService,
  input: ReservationRequest,
) {
  const dateKey = input.serviceDate.toISOString().slice(0, 10);
  await db.$executeRaw(
    Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`BOOKING_CAPACITY:${input.practiceLocationId}:${dateKey}`},0))`,
  );
  const { configuration, calendar, zone, toInstant } =
    await loadTimeSlotCalendar(
      db,
      availability,
      input.practiceLocationId,
      input.serviceDate,
      input.now,
      input.excludeAppointmentIds,
    );
  if (configuration.appointmentMode !== AppointmentMode.TIME_SLOT_MODE)
    throw new ConflictException(
      'This Service Date does not use Time-Slot Mode.',
    );
  const policy = new TimeSlotAvailabilityPolicy();
  const actual = input.members.map((m) => m.actualMinutes);
  const allotments =
    input.members.length > 1 || input.groupMember
      ? policy.groupAllotments(actual, configuration.maximumBookableMinutes)
      : actual;
  if (
    !input.staff &&
    !input.groupMember &&
    input.members.length === 1 &&
    configuration.maximumBookableMinutes !== null &&
    actual[0] > configuration.maximumBookableMinutes
  ) {
    throw new ConflictException({
      code: 'CLINIC_ASSISTED_SCHEDULING_REQUIRED',
      message:
        'These Services require clinic-assisted scheduling. Contact the clinic.',
    });
  }
  const first = input.members[0]?.reservationAt;
  if (!first) throw new ConflictException('Select a Reservation Time.');
  const selected =
    input.fragmented || input.members.length === 1
      ? input.members.map((member, i) => ({
          start: member.reservationAt
            ? localMinute(member.reservationAt, zone)
            : NaN,
          minutes: allotments[i],
        }))
      : policy.continuousMembers(localMinute(first, zone), allotments);
  for (let i = 0; i < selected.length; i++) {
    const minute = selected[i].start;
    if (!Number.isInteger(minute) || minute % 30 !== 0)
      throw new ConflictException(
        'Reservation Times must use local half-hour boundaries.',
      );
    const supplied =
      input.fragmented || i === 0 ? input.members[i].reservationAt : null;
    if (supplied && toInstant(minute).getTime() !== supplied.getTime())
      throw new ConflictException(
        'Reservation Time must belong to the selected clinic Service Date.',
      );
  }
  const fits =
    input.members.length > 1 && !input.fragmented
      ? policy
          .continuousGroup(
            calendar,
            actual,
            configuration.maximumBookableMinutes,
          )
          .includes(selected[0].start)
      : policy.fragmentedGroup(calendar, selected, null);
  if (!fits && !(input.staff && input.confirmOverride))
    throw new ConflictException({
      code: input.staff
        ? 'RESERVATION_OVERRIDE_CONFIRMATION_REQUIRED'
        : 'RESERVATION_UNAVAILABLE',
      message: input.staff
        ? 'This reservation conflicts with calculated availability. Explicit confirmation is required.'
        : 'The selected reservation is unavailable. Choose another time, date or clinic. Your verified OTP remains valid within its existing continuation.',
      alternatives: [
        'FRAGMENTED_SAME_DAY',
        'ANOTHER_DATE',
        'ANOTHER_CLINIC',
        'CONTACT_CLINIC',
      ],
    });
  return selected.map((member, i) => ({
    appointmentMode: AppointmentMode.TIME_SLOT_MODE,
    reservationAt: toInstant(member.start),
    originalReservationAt: toInstant(member.start),
    schedulingAllotmentMinutes: allotments[i],
    estimatedServiceMinutes: actual[i],
    availabilityOverride: !fits,
  }));
}
