import { BadRequestException, ConflictException } from '@nestjs/common';
import { AppointmentMode, Prisma } from '../../generated/prisma/client';
import { ScheduleTimeService } from './schedule-time.service';

export type ProtectedPeriod = {
  weekday: number;
  startMinute: number;
  endMinute: number;
};
export type AppointmentModeProposal = {
  appointmentMode: AppointmentMode;
  effectiveServiceDate: string;
  maximumBookableMinutes: number | null;
  protectedPeriods: ProtectedPeriod[];
};

export function parseAppointmentModeProposal(
  value: unknown,
): AppointmentModeProposal {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new BadRequestException(
      'Appointment Mode configuration is required.',
    );
  const p = value as Record<string, unknown>;
  if (
    p.appointmentMode !== AppointmentMode.QUEUE_MODE &&
    p.appointmentMode !== AppointmentMode.TIME_SLOT_MODE
  )
    throw new BadRequestException('Invalid Appointment Mode.');
  if (typeof p.effectiveServiceDate !== 'string')
    throw new BadRequestException('An effective Service Date is required.');
  new ScheduleTimeService().parseServiceDate(p.effectiveServiceDate);
  const maximum = p.maximumBookableMinutes;
  if (
    maximum !== null &&
    (typeof maximum !== 'number' ||
      !Number.isInteger(maximum) ||
      maximum < 1 ||
      maximum > 4320)
  )
    throw new BadRequestException(
      'Maximum bookable minutes must be null or between 1 and 4320.',
    );
  if (!Array.isArray(p.protectedPeriods) || p.protectedPeriods.length > 100)
    throw new BadRequestException(
      'Protected periods must be an array of at most 100 intervals.',
    );
  const periods = p.protectedPeriods.map((item: unknown) => {
    if (!item || typeof item !== 'object')
      throw new BadRequestException('Invalid protected period.');
    const period = item as Record<string, unknown>;
    const { weekday, startMinute, endMinute } = period;
    if (
      typeof weekday !== 'number' ||
      !Number.isInteger(weekday) ||
      weekday < 0 ||
      weekday > 6 ||
      typeof startMinute !== 'number' ||
      !Number.isInteger(startMinute) ||
      startMinute < 0 ||
      typeof endMinute !== 'number' ||
      !Number.isInteger(endMinute) ||
      endMinute > 1440 ||
      endMinute <= startMinute
    ) {
      throw new BadRequestException(
        'Protected periods require weekday 0–6 and ordered local minutes 0–1440.',
      );
    }
    return { weekday, startMinute, endMinute };
  });
  return {
    appointmentMode: p.appointmentMode,
    effectiveServiceDate: p.effectiveServiceDate,
    maximumBookableMinutes: maximum,
    protectedPeriods: periods,
  };
}

export async function resolveAppointmentMode(
  db: Prisma.TransactionClient,
  practiceLocationId: string,
  serviceDate: Date,
) {
  const configuration = await db.appointmentModeConfiguration.findFirst({
    where: { practiceLocationId, effectiveServiceDate: { lte: serviceDate } },
    orderBy: [
      { effectiveServiceDate: 'desc' },
      { createdAt: 'desc' },
      { id: 'desc' },
    ],
  });
  // A populated date retains its mode, including dates containing terminal appointments.
  const existing = await db.appointment.findFirst({
    where: { practiceLocationId, serviceDate },
    select: { appointmentMode: true },
  });
  return {
    appointmentMode:
      existing?.appointmentMode ??
      configuration?.appointmentMode ??
      AppointmentMode.QUEUE_MODE,
    maximumBookableMinutes: configuration?.maximumBookableMinutes ?? null,
    protectedPeriods: (configuration?.protectedPeriods ??
      []) as ProtectedPeriod[],
  };
}

/** Called only after owning-Doctor approval/authorization in the shared configuration transaction. */
export async function applyAppointmentModeProposal(
  db: Prisma.TransactionClient,
  practiceLocationId: string,
  value: unknown,
  actorUserId: string,
  sourceDraftId: string | null,
  now = new Date(),
) {
  const proposal = parseAppointmentModeProposal(value);
  const location = await db.practiceLocation.findUniqueOrThrow({
    where: { id: practiceLocationId },
    select: { doctorProfileId: true, timeZone: true },
  });
  await db.$executeRaw(
    Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`DOCTOR_SCHEDULE|${location.doctorProfileId}`},0))`,
  );
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: location.timeZone ?? 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  if (proposal.effectiveServiceDate <= today)
    throw new ConflictException(
      'Appointment Mode configuration must begin on a future Service Date.',
    );
  const effectiveServiceDate = new Date(
    `${proposal.effectiveServiceDate}T00:00:00.000Z`,
  );
  const conflict = await db.appointment.findFirst({
    where: {
      practiceLocationId,
      serviceDate: { gte: effectiveServiceDate },
      appointmentMode: { not: proposal.appointmentMode },
    },
    orderBy: { serviceDate: 'desc' },
    select: { serviceDate: true },
  });
  if (conflict)
    throw new ConflictException({
      code: 'MODE_TRANSITION_HAS_EXISTING_APPOINTMENTS',
      message:
        'Choose an effective date after existing appointments in the other mode.',
      lastProtectedServiceDate: conflict.serviceDate.toISOString().slice(0, 10),
    });
  const pending = await db.appointmentModeConfiguration.findFirst({
    where: {
      practiceLocationId,
      effectiveServiceDate: { gt: effectiveServiceDate },
    },
  });
  if (pending)
    throw new ConflictException(
      'A later configuration is already scheduled. Choose a date on or after that configuration.',
    );
  const latestRevision = await db.appointmentModeConfiguration.findFirst({
    where: { practiceLocationId },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true },
  });
  // PostgreSQL's default CURRENT_TIMESTAMP reflects transaction start, which
  // can precede time spent waiting for this lock. Keep revisions strictly ordered.
  const createdAt = new Date(
    Math.max(Date.now(), (latestRevision?.createdAt.getTime() ?? 0) + 1),
  );
  return db.appointmentModeConfiguration.create({
    data: {
      createdAt,
      practiceLocationId,
      effectiveServiceDate,
      appointmentMode: proposal.appointmentMode,
      maximumBookableMinutes: proposal.maximumBookableMinutes,
      protectedPeriods: proposal.protectedPeriods,
      actorUserId,
      sourceDraftId,
    },
  });
}
