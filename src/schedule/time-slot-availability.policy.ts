/** Pure local-minute policy. Timezone conversion and authorization belong to callers. */
export type SlotInterval = { start: number; end: number };
export type ReservedWorkload = { start: number; minutes: number };
export type SlotCalendar = {
  opens: number;
  closes: number;
  maximumOperatingUntil: number;
  notBefore?: number;
  protectedPeriods: SlotInterval[];
  reservations: ReservedWorkload[];
};

export class TimeSlotAvailabilityPolicy {
  static readonly intervalMinutes = 30;
  static readonly toleranceMinutes = 15;

  /** Exactly fifteen minutes after a boundary still maps to that boundary. */
  nextBoundary(completion: number): number {
    const floor = Math.floor(completion / 30) * 30;
    return completion - floor <= 15 ? floor : floor + 30;
  }

  actualDuration(serviceMinutes: readonly number[]): number {
    if (
      !serviceMinutes.length ||
      serviceMinutes.some((n) => !Number.isInteger(n) || n < 1)
    ) {
      throw new RangeError(
        'At least one positive Service duration is required.',
      );
    }
    return serviceMinutes.reduce((sum, n) => sum + n, 0);
  }

  groupAllotments(
    actualMinutes: readonly number[],
    maximum: number | null,
  ): number[] {
    this.validateDurations(actualMinutes, maximum);
    return actualMinutes.map((n) =>
      maximum === null ? n : Math.min(n, maximum),
    );
  }

  individual(
    calendar: SlotCalendar,
    minutes: number,
    maximum: number | null,
  ): number[] {
    this.validateDurations([minutes], maximum);
    if (maximum !== null && minutes > maximum) return [];
    return this.starts(calendar, minutes);
  }

  continuousGroup(
    calendar: SlotCalendar,
    actualMinutes: readonly number[],
    maximum: number | null,
  ): number[] {
    const allotments = this.groupAllotments(actualMinutes, maximum);
    return this.starts(calendar, 1).filter((start) => {
      const members = this.continuousMembers(start, allotments);
      const last = members[members.length - 1];
      const span = last.start + last.minutes - start;
      return (
        this.canReserve(calendar, start, span) &&
        members.every((member) =>
          this.canReserve(calendar, member.start, member.minutes),
        )
      );
    });
  }

  /** Owner clarification: distinct half-hour times; gaps count toward occupied span. */
  continuousMembers(
    start: number,
    allotments: readonly number[],
  ): ReservedWorkload[] {
    this.validateDurations(allotments, null);
    const members: ReservedWorkload[] = [];
    let cursor = start;
    for (const minutes of allotments) {
      members.push({ start: cursor, minutes });
      cursor = Math.max(cursor + 30, this.nextBoundary(cursor + minutes));
    }
    return members;
  }

  /** Validate the entire proposed set, including conflicts between members. */
  fragmentedGroup(
    calendar: SlotCalendar,
    selected: readonly ReservedWorkload[],
    maximum: number | null,
  ): boolean {
    const allotments = this.groupAllotments(
      selected.map((m) => m.minutes),
      maximum,
    );
    const reservations = [...calendar.reservations];
    const ordered = selected
      .map((m, i) => ({ start: m.start, minutes: allotments[i] }))
      .sort((a, b) => a.start - b.start);
    for (const member of ordered) {
      if (
        !this.canReserve(
          { ...calendar, reservations },
          member.start,
          member.minutes,
        )
      )
        return false;
      reservations.push(member);
    }
    return true;
  }

  starts(calendar: SlotCalendar, minutes: number): number[] {
    this.validateDurations([minutes], null);
    const starts: number[] = [];
    for (
      let start = Math.ceil(calendar.opens / 30) * 30;
      start < calendar.closes;
      start += 30
    ) {
      if (this.canReserve(calendar, start, minutes)) starts.push(start);
    }
    return starts;
  }

  canReserve(calendar: SlotCalendar, start: number, minutes: number): boolean {
    if (
      !Number.isInteger(start) ||
      start % 30 !== 0 ||
      !Number.isInteger(minutes) ||
      minutes < 1
    )
      return false;
    if (
      start < Math.max(calendar.opens, calendar.notBefore ?? calendar.opens) ||
      start >= calendar.closes
    )
      return false;
    if (start + minutes > calendar.maximumOperatingUntil) return false;
    // Protected periods prohibit reservation slots, not finishing existing work.
    if (
      calendar.protectedPeriods.some(
        (p) => start < p.end && start + 30 > p.start,
      )
    )
      return false;
    for (const existing of calendar.reservations) {
      if (existing.start === start) return false;
      if (
        existing.start < start &&
        this.nextBoundary(existing.start + existing.minutes) > start
      )
        return false;
      if (
        existing.start > start &&
        this.nextBoundary(start + minutes) > existing.start
      )
        return false;
    }
    return true;
  }

  private validateDurations(
    minutes: readonly number[],
    maximum: number | null,
  ) {
    if (
      !minutes.length ||
      minutes.some((n) => !Number.isInteger(n) || n < 1) ||
      (maximum !== null && (!Number.isInteger(maximum) || maximum < 1))
    ) {
      throw new RangeError(
        'Durations and optional maximum must be positive whole minutes.',
      );
    }
  }
}
