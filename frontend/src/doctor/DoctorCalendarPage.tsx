import { useEffect, useMemo, useState } from 'react';
import { apiRequest } from '../api/client';

type CalendarRule = {
  id: string;
  startDate: string;
  endDate: string | null;
  recurrenceType: string;
  customLabel: string | null;
  monthlyDayOfMonth?: number | null;
  weeklyWeekdays?: Array<{ weekday: string }>;
};
type ClinicSchedule = {
  weekday: string;
  opensAtLocal: string | null;
  closesAtLocal: string | null;
};
type Clinic = {
  id: string;
  name: string | null;
  cityMunicipality: string | null;
  timeZone: string | null;
  practiceSchedules: ClinicSchedule[];
};
type CalendarData = {
  month: string;
  timeZone: string;
  rules: CalendarRule[];
  clinics: Clinic[];
};
type CalendarImpact = {
  date: string;
  appointmentCount: number;
  requiresPassword: boolean;
  clinics: Array<{
    clinicId: string;
    clinicName: string;
    appointmentCount: number;
  }>;
  appointments: Array<{
    id: string;
    bookingReference: string;
    queueNumber: number;
    patientName: string;
    status: string;
    clinicName: string;
  }>;
};

const weekdays = [
  'SUNDAY',
  'MONDAY',
  'TUESDAY',
  'WEDNESDAY',
  'THURSDAY',
  'FRIDAY',
  'SATURDAY',
];
const weekdayShort = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const dateKey = (date: Date) => date.toISOString().slice(0, 10);
const monthKey = (date: Date) => date.toISOString().slice(0, 7);
const time = (value: string | null) =>
  value
    ? new Date(value).toLocaleTimeString([], {
        hour: 'numeric',
        minute: '2-digit',
        timeZone: 'UTC',
      })
    : '—';

export function DoctorCalendarPage() {
  const [month, setMonth] = useState(
    () =>
      new Date(Date.UTC(new Date().getFullYear(), new Date().getMonth(), 1)),
  );
  const [selected, setSelected] = useState(() => dateKey(new Date()));
  const [data, setData] = useState<CalendarData | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const [impact, setImpact] = useState<CalendarImpact | null>(null);
  const [password, setPassword] = useState('');

  useEffect(() => {
    let cancelled = false;
    setError('');
    void apiRequest<CalendarData>(`/doctor-calendar?month=${monthKey(month)}`)
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((cause) => {
        if (!cancelled)
          setError(
            cause instanceof Error
              ? cause.message
              : 'Unable to load the calendar.',
          );
      });
    return () => {
      cancelled = true;
    };
  }, [month, revision]);

  const days = useMemo(() => {
    const year = month.getUTCFullYear();
    const index = month.getUTCMonth();
    const first = new Date(Date.UTC(year, index, 1));
    const count = new Date(Date.UTC(year, index + 1, 0)).getUTCDate();
    return [
      ...Array(first.getUTCDay()).fill(null),
      ...Array.from(
        { length: count },
        (_, i) => new Date(Date.UTC(year, index, i + 1)),
      ),
    ];
  }, [month]);
  while (days.length % 7) days.push(null);

  const ruleFor = (key: string) =>
    data?.rules.find((rule) => {
      const start = rule.startDate.slice(0, 10);
      const end = rule.endDate?.slice(0, 10);
      if (key < start || (end && key > end)) return false;
      if (rule.recurrenceType === 'SINGLE_DATE') return key === start;
      if (
        rule.recurrenceType === 'DATE_RANGE' ||
        rule.recurrenceType === 'DAILY'
      )
        return true;
      const date = new Date(`${key}T00:00:00.000Z`);
      if (rule.recurrenceType === 'WEEKLY')
        return rule.weeklyWeekdays?.some(
          (row) => row.weekday === weekdays[date.getUTCDay()],
        );
      if (rule.recurrenceType === 'MONTHLY_DATE')
        return date.getUTCDate() === rule.monthlyDayOfMonth;
      return false;
    });
  const clinicsFor = (date: Date) =>
    data?.clinics.filter((clinic) =>
      clinic.practiceSchedules.some(
        (schedule) => schedule.weekday === weekdays[date.getUTCDay()],
      ),
    ) ?? [];
  const selectedDate = new Date(`${selected}T00:00:00.000Z`);
  const selectedRule = ruleFor(selected);
  const selectedClinics = clinicsFor(selectedDate);
  const monthLabel = month.toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
  const unavailable =
    data?.rules.filter(
      (rule) => rule.startDate.slice(0, 7) === monthKey(month),
    ) ?? [];
  const clinicHours =
    data?.clinics.reduce(
      (total, clinic) =>
        total +
        clinic.practiceSchedules.reduce((sum, schedule) => {
          if (!schedule.opensAtLocal || !schedule.closesAtLocal) return sum;
          return (
            sum +
            (new Date(schedule.closesAtLocal).getTime() -
              new Date(schedule.opensAtLocal).getTime()) /
              3_600_000
          );
        }, 0),
      0,
    ) ?? 0;

  function moveMonth(offset: number) {
    const next = new Date(
      Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + offset, 1),
    );
    setMonth(next);
    setSelected(dateKey(next));
  }
  async function toggleUnavailable() {
    setBusy(true);
    setError('');
    try {
      if (selectedRule)
        await apiRequest(
          `/doctor-calendar/unavailable-dates/${encodeURIComponent(selectedRule.id)}`,
          { method: 'DELETE' },
        );
      else {
        const report = await apiRequest<CalendarImpact>(
          `/doctor-calendar/unavailable-dates/impact?date=${encodeURIComponent(selected)}`,
        );
        setImpact(report);
        return;
      }
      setRevision((value) => value + 1);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Unable to update this date.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function confirmUnavailable() {
    if (!impact) return;
    setBusy(true);
    setError('');
    try {
      await apiRequest('/doctor-calendar/unavailable-dates/confirm', {
        method: 'POST',
        body: {
          date: impact.date,
          cancelAffectedAppointments: impact.appointmentCount > 0,
          ...(impact.requiresPassword ? { password } : {}),
        },
      });
      setImpact(null);
      setPassword('');
      setRevision((value) => value + 1);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Unable to mark this date unavailable.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="doctor-calendar-page">
      <header>
        <div>
          <h1>Calendar</h1>
          <p>Manage your availability across all your clinics.</p>
        </div>
        <button
          className="calendar-outline"
          onClick={() =>
            document
              .querySelector('.upcoming-unavailable')
              ?.scrollIntoView({ behavior: 'smooth' })
          }
        >
          ☷ &nbsp; Unavailable Dates ({data?.rules.length ?? 0})
        </button>
        <button
          className="calendar-primary"
          onClick={() => void toggleUnavailable()}
        >
          {selectedRule ? 'Restore Availability' : '＋ Mark Unavailable'}
        </button>
      </header>
      {error ? (
        <div className="calendar-error" role="alert">
          {error}
        </div>
      ) : null}
      <div className="calendar-info">
        <strong>ⓘ &nbsp; Doctor Calendar</strong>
        <span>
          Dates you mark as unavailable will block clinic operation for all your
          practice locations.
        </span>
      </div>
      <div className="calendar-layout">
        <main>
          <div className="calendar-controls">
            <button onClick={() => moveMonth(-1)}>‹</button>
            <button onClick={() => moveMonth(1)}>›</button>
            <h2>{monthLabel}</h2>
            <button
              onClick={() => {
                const now = new Date();
                const next = new Date(
                  Date.UTC(now.getFullYear(), now.getMonth(), 1),
                );
                setMonth(next);
                setSelected(dateKey(now));
              }}
            >
              Today
            </button>
            <div className="calendar-legend">
              <span>● Available</span>
              <span>⊗ Unavailable</span>
              <span>● Has Clinic Schedule</span>
            </div>
          </div>
          <div className="month-grid">
            {weekdayShort.map((day) => (
              <strong key={day}>{day}</strong>
            ))}
            {days.map((date, index) =>
              date ? (
                (() => {
                  const key = dateKey(date);
                  const blocked = Boolean(ruleFor(key));
                  const clinics = clinicsFor(date);
                  return (
                    <button
                      key={key}
                      className={`${selected === key ? 'is-selected' : ''} ${blocked ? 'is-unavailable' : ''}`}
                      onClick={() => setSelected(key)}
                    >
                      <b>{date.getUTCDate()}</b>
                      {blocked ? (
                        <span className="blocked-mark">
                          ⊗<small>Unavailable</small>
                        </span>
                      ) : (
                        clinics.slice(0, 2).map((clinic) => (
                          <span className="clinic-dot" key={clinic.id}>
                            • {clinic.name}
                          </span>
                        ))
                      )}
                    </button>
                  );
                })()
              ) : (
                <span className="blank-day" key={`blank-${index}`} />
              ),
            )}
          </div>
          <section className="calendar-summary">
            <h3>Calendar Summary</h3>
            <div>
              <article className="green">
                <b>{days.filter(Boolean).length - unavailable.length}</b>
                <strong>Available Days</strong>
                <span>This month</span>
              </article>
              <article className="red">
                <b>{unavailable.length}</b>
                <strong>Unavailable Days</strong>
                <span>This month</span>
              </article>
              <article className="blue">
                <b>{data?.clinics.length ?? 0}</b>
                <strong>Practice Locations</strong>
                <span>With schedules</span>
              </article>
              <article>
                <b>{clinicHours.toFixed(1)}</b>
                <strong>Total Weekly Clinic Hours</strong>
                <span>Across active clinics</span>
              </article>
            </div>
          </section>
        </main>
        <aside>
          <section className="calendar-day-panel">
            <h2>
              {selectedDate.toLocaleDateString('en-US', {
                weekday: 'long',
                month: 'long',
                day: 'numeric',
                year: 'numeric',
                timeZone: 'UTC',
              })}
            </h2>
            <span
              className={selectedRule ? 'day-unavailable' : 'day-available'}
            >
              ● {selectedRule ? 'Unavailable' : 'Available'}
            </span>
            <p>
              You are {selectedRule ? 'unavailable' : 'available'} on this date.
            </p>
            <h3>Scheduled Clinics</h3>
            {selectedClinics.length ? (
              selectedClinics.map((clinic) => {
                const schedule = clinic.practiceSchedules.find(
                  (row) => row.weekday === weekdays[selectedDate.getUTCDay()],
                );
                return (
                  <article className="scheduled-clinic" key={clinic.id}>
                    <span>▥</span>
                    <div>
                      <strong>{clinic.name}</strong>
                      <p>
                        {time(schedule?.opensAtLocal ?? null)} –{' '}
                        {time(schedule?.closesAtLocal ?? null)}
                      </p>
                      <small>Regular schedule</small>
                    </div>
                  </article>
                );
              })
            ) : (
              <p className="muted">
                No clinic is regularly scheduled for this day.
              </p>
            )}
            <hr />
            <h3>About this date</h3>
            <p>
              ▣ &nbsp;{' '}
              {selectedRule
                ? selectedRule.customLabel || 'Marked unavailable by you.'
                : 'All clinics will follow their regular schedules.'}
            </p>
            <button
              className="calendar-outline full"
              disabled={busy}
              onClick={() => void toggleUnavailable()}
            >
              {selectedRule ? 'Restore Availability' : '▣  Mark Unavailable'}
            </button>
          </section>
          <section className="upcoming-unavailable">
            <h3>Upcoming Unavailable Dates</h3>
            {data?.rules.slice(0, 5).map((rule) => (
              <button
                key={rule.id}
                onClick={() => {
                  const key = rule.startDate.slice(0, 10);
                  setSelected(key);
                  setMonth(new Date(`${key.slice(0, 7)}-01T00:00:00.000Z`));
                }}
              >
                <span>⊗</span>
                <strong>
                  {new Date(rule.startDate).toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                    timeZone: 'UTC',
                  })}
                </strong>
                <small>
                  {new Date(rule.startDate).toLocaleDateString('en-US', {
                    weekday: 'long',
                    timeZone: 'UTC',
                  })}
                </small>
              </button>
            ))}
          </section>
        </aside>
      </div>
      {impact ? (
        <div className="calendar-dialog-backdrop" role="presentation">
          <section
            className="calendar-impact-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="calendar-impact-title"
          >
            <button
              className="calendar-dialog-close"
              aria-label="Close"
              onClick={() => {
                setImpact(null);
                setPassword('');
              }}
            >
              ×
            </button>
            <span className="calendar-warning-icon">!</span>
            <h2 id="calendar-impact-title">
              Mark{' '}
              {new Date(`${impact.date}T00:00:00.000Z`).toLocaleDateString(
                'en-US',
                {
                  month: 'long',
                  day: 'numeric',
                  year: 'numeric',
                  timeZone: 'UTC',
                },
              )}{' '}
              unavailable?
            </h2>
            {impact.appointmentCount ? (
              <>
                <p>
                  This will close the date across all your clinics and cancel{' '}
                  <strong>
                    {impact.appointmentCount} active appointment
                    {impact.appointmentCount === 1 ? '' : 's'}
                  </strong>
                  . Affected patients with operational messages enabled will be
                  notified.
                </p>
                <div className="calendar-impact-clinics">
                  {impact.clinics.map((clinic) => (
                    <div key={clinic.clinicId}>
                      <strong>{clinic.clinicName}</strong>
                      <span>
                        {clinic.appointmentCount} appointment
                        {clinic.appointmentCount === 1 ? '' : 's'}
                      </span>
                    </div>
                  ))}
                </div>
                <details>
                  <summary>View affected appointments</summary>
                  {impact.appointments.map((appointment) => (
                    <div
                      className="calendar-impact-appointment"
                      key={appointment.id}
                    >
                      <span>
                        #{appointment.queueNumber} · {appointment.patientName}
                      </span>
                      <small>
                        {appointment.clinicName} ·{' '}
                        {appointment.bookingReference}
                      </small>
                    </div>
                  ))}
                </details>
                <label>
                  Current password
                  <input
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                  />
                </label>
              </>
            ) : (
              <p>
                No active appointments will be cancelled. All clinics will be
                unavailable on this date and new bookings will be blocked.
              </p>
            )}
            <footer>
              <button
                className="calendar-outline"
                disabled={busy}
                onClick={() => {
                  setImpact(null);
                  setPassword('');
                }}
              >
                Keep Date Available
              </button>
              <button
                className="calendar-primary"
                disabled={busy || (impact.requiresPassword && !password)}
                onClick={() => void confirmUnavailable()}
              >
                {busy
                  ? 'Applying…'
                  : impact.appointmentCount
                    ? 'Cancel Appointments & Mark Unavailable'
                    : 'Confirm Unavailable Date'}
              </button>
            </footer>
          </section>
        </div>
      ) : null}
    </section>
  );
}
