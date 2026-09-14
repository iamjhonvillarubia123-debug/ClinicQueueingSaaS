import { ConflictException } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { ScheduleTimeService } from '../schedule/schedule-time.service';
import { RecurringScheduleConflictService } from '../schedule/recurring-schedule-conflict.service';
import { PrismaService } from '../prisma/prisma.service';

type Range = { fromServiceDate: string; toServiceDate: string };
const select = {
  id: true,
  name: true,
  timeZone: true,
  practiceSchedules: true,
  scheduleExceptions: true,
} satisfies Prisma.PracticeLocationSelect;
type Clinic = Prisma.PracticeLocationGetPayload<{ select: typeof select }>;
const time = new ScheduleTimeService();
const dayMs = 86400000;
const iso = (date: Date) => date.toISOString().slice(0, 10);
const shift = (date: string, offset: number) =>
  iso(new Date(new Date(date).getTime() + offset * dayMs));
const covered = (date: string, ranges: Range[] | null) =>
  ranges === null ||
  ranges.some((r) => r.fromServiceDate <= date && r.toServiceDate >= date);
function interval(clinic: Clinic, date: string) {
  const parts = time.parseServiceDate(date);
  const schedule =
    clinic.scheduleExceptions.find((e) => iso(e.serviceDate) === date) ??
    clinic.practiceSchedules.find((s) => s.weekday === time.weekday(parts));
  if (!schedule?.isOpen) return null;
  if (!clinic.timeZone || !schedule.opensAtLocal || !schedule.closesAtLocal)
    throw new ConflictException(
      'Clinic schedules must be configured before accepting this invitation.',
    );
  return {
    start: time.localDateTimeToInstant(
      parts,
      time.timeFromDatabase(schedule.opensAtLocal),
      clinic.timeZone,
    ),
    end: time.localDateTimeToInstant(
      parts,
      time.timeFromDatabase(schedule.closesAtLocal),
      clinic.timeZone,
    ),
  };
}
export async function assertSecretaryScheduleAvailable(
  tx: Prisma.TransactionClient,
  userId: string,
  clinicId: string,
  requested: Range[] | null,
  now: Date,
) {
  const assignments = await tx.practiceStaff.findMany({
    where: {
      userId,
      isActive: true,
      disconnectedAt: null,
      practiceLocationId: { not: clinicId },
    },
    include: {
      authorityBundles: { where: { status: 'ACTIVE' } },
      substituteSecretaryCoverages: { where: { status: 'ACTIVE' } },
      practiceLocation: { select },
    },
  });
  if (!assignments.length) return;
  const candidate = await tx.practiceLocation.findUniqueOrThrow({
    where: { id: clinicId },
    select,
  });
  for (const assignment of assignments) {
    const other = assignment.practiceLocation;
    const existing: Range[] | null = assignment.authorityBundles.length
      ? null
      : assignment.substituteSecretaryCoverages.map((r) => ({
          fromServiceDate: iso(r.fromServiceDate),
          toServiceDate: iso(r.toServiceDate),
        }));
    if (existing?.length === 0) continue;
    const fail = () => {
      throw new ConflictException(
        `This invitation conflicts with your schedule at ${other.name ?? 'another connected clinic'}. Disconnect from that clinic in Clinics before accepting, or decline this invitation.`,
      );
    };
    if (requested === null && existing === null) {
      const open = (clinic: Clinic) =>
        clinic.practiceSchedules
          .filter((s) => s.isOpen && s.opensAtLocal && s.closesAtLocal)
          .map((s) => ({
            weekday: s.weekday,
            opensAtLocal: s.opensAtLocal!,
            closesAtLocal: s.closesAtLocal!,
          }));
      try {
        new RecurringScheduleConflictService(
          tx as unknown as PrismaService,
          time,
        ).assertSchedulesDoNotOverlap(
          open(candidate),
          candidate.timeZone ?? '',
          open(other),
          other.timeZone ?? '',
        );
      } catch (error) {
        if (error instanceof ConflictException) fail();
        throw error;
      }
    }
    // Enumerate finite coverage exactly. For two regular assignments, recurring
    // hours were checked above; only explicit exception dates remain to check.
    const source =
      requested !== null ? candidate : existing !== null ? other : candidate;
    const target = source === candidate ? other : candidate;
    const sourceRanges = source === candidate ? requested : existing;
    const targetRanges = source === candidate ? existing : requested;
    const dates = new Set<string>();
    if (sourceRanges !== null)
      for (const r of sourceRanges) {
        for (let d = r.fromServiceDate; d <= r.toServiceDate; d = shift(d, 1))
          dates.add(d);
      }
    else
      for (const e of [
        ...candidate.scheduleExceptions,
        ...other.scheduleExceptions,
      ])
        for (let offset = -2; offset <= 2; offset++)
          dates.add(shift(iso(e.serviceDate), offset));
    for (const date of dates) {
      const a = interval(source, date);
      if (!a || a.end <= now) continue;
      // Local dates can differ across time zones; check neighboring dates too.
      for (let offset = -2; offset <= 2; offset++) {
        const otherDate = shift(date, offset);
        if (!covered(otherDate, targetRanges)) continue;
        const b = interval(target, otherDate);
        if (b && a.start < b.end && b.start < a.end) fail();
      }
    }
  }
}
