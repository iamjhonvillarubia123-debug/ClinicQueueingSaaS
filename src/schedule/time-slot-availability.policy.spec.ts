import {
  SlotCalendar,
  TimeSlotAvailabilityPolicy,
} from './time-slot-availability.policy';

describe('approved Time-Slot availability policy', () => {
  const policy = new TimeSlotAvailabilityPolicy();
  const empty: SlotCalendar = {
    opens: 540,
    closes: 1020,
    maximumOperatingUntil: 1080,
    protectedPeriods: [],
    reservations: [],
  };

  it.each([
    [570, 570],
    [584, 570],
    [585, 570],
    [586, 600],
    [615, 600],
    [645, 630],
    [646, 660],
  ])(
    'maps expected finish %i to %i with inclusive tolerance',
    (finish, expected) => {
      expect(policy.nextBoundary(finish)).toBe(expected);
    },
  );
  it('adds services and rejects individual self-booking beyond the maximum without trimming services', () => {
    const actual = policy.actualDuration([30, 20, 40]);
    expect(actual).toBe(90);
    expect(policy.individual(empty, actual, 60)).toEqual([]);
    expect(policy.individual(empty, actual, null)).toContain(540);
  });
  it.each([
    [[90, 90, 90], 180],
    [[90, 10, 30], 100],
  ])('caps each group member independently: %j => %i', (actual, expected) => {
    const original = [...actual];
    expect(policy.groupAllotments(actual, 60).reduce((a, b) => a + b, 0)).toBe(
      expected,
    );
    expect(actual).toEqual(original);
  });
  it('keeps duplicate workloads independent and uses the latest completion', () => {
    const calendar = {
      ...empty,
      reservations: [
        { start: 600, minutes: 30 },
        { start: 600, minutes: 30 },
      ],
    };
    expect(policy.starts(calendar, 30)).toContain(630);
    expect(policy.starts(calendar, 30)).not.toContain(600);
    calendar.reservations.push({ start: 600, minutes: 76 });
    expect(policy.starts(calendar, 30)).not.toContain(660);
    expect(policy.starts(calendar, 30)).toContain(690);
  });
  it('assigns distinct group times and includes short-member gaps in the fit check', () => {
    const allotments = policy.groupAllotments([90, 10, 30], 60);
    expect(policy.continuousMembers(540, allotments)).toEqual([
      { start: 540, minutes: 60 },
      { start: 600, minutes: 10 },
      { start: 630, minutes: 30 },
    ]);
    expect(
      policy.continuousGroup(
        { ...empty, closes: 640, maximumOperatingUntil: 640 },
        [90, 10, 30],
        60,
      ),
    ).toEqual([]);
    expect(
      policy.continuousGroup(
        { ...empty, closes: 660, maximumOperatingUntil: 660 },
        [90, 10, 30],
        60,
      ),
    ).toEqual([540]);
  });
  it('does not chain a tolerated overlapping reservation after the prior completion', () => {
    const calendar = {
      ...empty,
      reservations: [
        { start: 540, minutes: 45 },
        { start: 570, minutes: 45 },
      ],
    };
    expect(policy.starts(calendar, 30)).toContain(600);
  });
  it('does not fill a gap with work that would consume an existing reservation', () => {
    expect(
      policy.canReserve(
        { ...empty, reservations: [{ start: 600, minutes: 30 }] },
        540,
        76,
      ),
    ).toBe(false);
    expect(
      policy.canReserve(
        { ...empty, reservations: [{ start: 600, minutes: 30 }] },
        540,
        75,
      ),
    ).toBe(true);
  });
  it('blocks protected slots but permits finishing existing work during a protected period', () => {
    const calendar = { ...empty, protectedPeriods: [{ start: 720, end: 780 }] };
    expect(policy.starts(calendar, 30)).not.toContain(720);
    expect(policy.starts(calendar, 30)).not.toContain(750);
    expect(policy.canReserve(calendar, 690, 60)).toBe(true);
  });
  it('releases all affected capacity after cancellation or moving the reservation', () => {
    expect(
      policy.starts(
        { ...empty, reservations: [{ start: 540, minutes: 90 }] },
        30,
      ),
    ).not.toContain(600);
    expect(policy.starts(empty, 30)).toEqual(
      expect.arrayContaining([540, 570, 600]),
    );
  });
  it('requires uninterrupted continuous group capacity and validates all fragmented members together', () => {
    const calendar = {
      ...empty,
      closes: 720,
      maximumOperatingUntil: 720,
      reservations: [{ start: 600, minutes: 30 }],
    };
    expect(policy.continuousGroup(calendar, [60, 60], null)).toEqual([]);
    expect(
      policy.fragmentedGroup(
        calendar,
        [
          { start: 540, minutes: 60 },
          { start: 630, minutes: 60 },
        ],
        null,
      ),
    ).toBe(true);
    expect(
      policy.fragmentedGroup(
        calendar,
        [
          { start: 540, minutes: 60 },
          { start: 570, minutes: 60 },
        ],
        null,
      ),
    ).toBe(false);
    expect(
      policy.fragmentedGroup(
        calendar,
        [
          { start: 540, minutes: 60 },
          { start: 540, minutes: 60 },
        ],
        null,
      ),
    ).toBe(false);
  });
  it('respects opening, closing, current time and maximum operating bounds', () => {
    const calendar = {
      ...empty,
      opens: 547,
      closes: 630,
      maximumOperatingUntil: 660,
      notBefore: 580,
    };
    expect(policy.starts(calendar, 60)).toEqual([600]);
    expect(policy.canReserve(calendar, 605, 30)).toBe(false);
  });
});
