import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ApiError, apiRequest } from '../api/client';

type AppointmentStatus =
  | 'WAITING'
  | 'CALLED'
  | 'TEMPORARILY_ABSENT'
  | 'OUT_FOR_PROCEDURE'
  | 'COMPLETED'
  | 'EXPIRED'
  | 'CANCELLED'
  | 'NO_SHOW'
  | 'RESCHEDULED';

type ClinicDayStatus =
  | 'NOT_STARTED'
  | 'DELAYED'
  | 'STARTED'
  | 'CLOSED'
  | 'CANCELLED'
  | null;

type AppointmentDashboard = {
  bookingReference: string;
  patientName: {
    firstName: string | null;
    middleName: string | null;
    lastName: string | null;
    suffix: string | null;
  };
  practiceLocation: { id: string; name: string };
  serviceDate: string;
  queueNumber: number;
  status: AppointmentStatus;
  estimatedServiceMinutes: number;
  clinicDayStatus: ClinicDayStatus;
  nowServingQueueNumber: number | null;
  patientsAhead: number | null;
  canUseImHere: boolean;
};

type ViewState = 'loading' | 'ready' | 'unavailable' | 'inaccessible' | 'error';
type Tone = 'neutral' | 'success' | 'attention' | 'danger';

type PatientPresentation = {
  title: string;
  detail: string;
  tone: Tone;
  clinicState: string;
};

function formatPatientQueueNumber(queueNumber: number): string {
  return String(queueNumber).padStart(3, '0');
}

function formatServiceDate(value: string) {
  const dateOnly = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!dateOnly) return value;

  const [, year, month, day] = dateOnly;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

function presentationFor(dashboard: AppointmentDashboard): PatientPresentation {
  if (dashboard.status === 'COMPLETED') {
    return {
      title: 'APPOINTMENT COMPLETED',
      detail: 'Thank you for visiting.',
      tone: 'neutral',
      clinicState: 'Completed',
    };
  }
  if (dashboard.status === 'CANCELLED') {
    return {
      title: 'APPOINTMENT CANCELLED',
      detail: 'This appointment has been cancelled.',
      tone: 'neutral',
      clinicState: 'Cancelled',
    };
  }
  if (dashboard.status === 'NO_SHOW') {
    return {
      title: 'APPOINTMENT ENDED',
      detail: 'The clinic day ended before you were served.',
      tone: 'neutral',
      clinicState: 'Closed',
    };
  }
  if (dashboard.status === 'EXPIRED') {
    return {
      title: 'APPOINTMENT EXPIRED',
      detail: 'This appointment is no longer active.',
      tone: 'neutral',
      clinicState: 'Closed',
    };
  }
  if (dashboard.status === 'RESCHEDULED') {
    return {
      title: 'APPOINTMENT RESCHEDULED',
      detail: 'Please use the latest appointment information provided by the clinic.',
      tone: 'neutral',
      clinicState: 'Updated',
    };
  }
  if (dashboard.status === 'CALLED') {
    return {
      title: "IT'S YOUR TURN",
      detail: 'Please proceed as instructed by the clinic.',
      tone: 'success',
      clinicState: 'Open · Serving',
    };
  }
  if (dashboard.status === 'TEMPORARILY_ABSENT') {
    return dashboard.canUseImHere
      ? {
          title: 'YOU MISSED YOUR TURN',
          detail: 'Your number was called but we did not hear from you.',
          tone: 'danger',
          clinicState: 'Open · Serving',
        }
      : {
          title: 'PLEASE SEE CLINIC STAFF',
          detail: 'Your number was called again. Please go to the reception desk for assistance.',
          tone: 'danger',
          clinicState: 'Open · Serving',
        };
  }
  if (dashboard.status === 'OUT_FOR_PROCEDURE') {
    return {
      title: 'OUT FOR PROCEDURE',
      detail: 'Clinic staff will return you to the queue when appropriate.',
      tone: 'attention',
      clinicState: 'Open · Serving',
    };
  }
  if (dashboard.clinicDayStatus === 'NOT_STARTED') {
    return {
      title: 'CLINIC NOT YET STARTED',
      detail: 'The queue will appear here when the clinic starts.',
      tone: 'attention',
      clinicState: 'Not yet started',
    };
  }
  if (dashboard.clinicDayStatus === 'DELAYED') {
    return {
      title: 'CLINIC START DELAYED',
      detail: 'Please wait for the clinic to start. Your Queue Number remains valid.',
      tone: 'attention',
      clinicState: 'Delayed',
    };
  }
  if (dashboard.clinicDayStatus === 'CLOSED' || dashboard.clinicDayStatus === 'CANCELLED') {
    return {
      title: 'CLINIC DAY ENDED',
      detail: 'The clinic is no longer serving this queue.',
      tone: 'neutral',
      clinicState: 'Closed',
    };
  }
  return {
    title: 'QUEUE IN PROGRESS',
    detail: 'The clinic is now serving patients.',
    tone: 'success',
    clinicState: 'Open · Serving',
  };
}

function isLiveQueue(status: AppointmentStatus, clinicDayStatus: ClinicDayStatus) {
  return (
    clinicDayStatus === 'STARTED' &&
    !['COMPLETED', 'CANCELLED', 'NO_SHOW', 'EXPIRED', 'RESCHEDULED'].includes(status)
  );
}

export function PatientAppointmentPage() {
  const { bookingReference } = useParams();
  const [dashboard, setDashboard] = useState<AppointmentDashboard | null>(null);
  const [viewState, setViewState] = useState<ViewState>('loading');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    if (!bookingReference) {
      setViewState('inaccessible');
      return;
    }
    setViewState('loading');
    setMessage('');
    try {
      const result = await apiRequest<AppointmentDashboard>(
        `/patient-bookings/${encodeURIComponent(bookingReference)}/dashboard`,
      );
      setDashboard(result);
      setViewState('ready');
    } catch (error) {
      setDashboard(null);
      if (error instanceof ApiError && error.status === 503) {
        setMessage(
          'This online service is temporarily unavailable. Your existing appointment has not been cancelled. Please try again later.',
        );
        setViewState('unavailable');
      } else if (
        error instanceof ApiError &&
        (error.status === 401 || error.status === 403 || error.status === 404)
      ) {
        setViewState('inaccessible');
      } else {
        setMessage(
          error instanceof ApiError
            ? error.message
            : 'Unable to load your appointment right now.',
        );
        setViewState('error');
      }
    }
  }, [bookingReference]);

  useEffect(() => {
    void load();
  }, [load]);

  const presentation = useMemo(
    () => (dashboard ? presentationFor(dashboard) : null),
    [dashboard],
  );

  async function imHere() {
    if (!bookingReference || !dashboard?.canUseImHere || submitting) return;
    setSubmitting(true);
    setMessage('');
    try {
      await apiRequest(`/patient-bookings/${encodeURIComponent(bookingReference)}/im-here`, {
        method: 'POST',
        headers: { 'Idempotency-Key': crypto.randomUUID() },
      });
      await load();
      setMessage("YOU'RE BACK IN THE QUEUE. Your Queue Number remains the same.");
    } catch (error) {
      setMessage(
        error instanceof ApiError
          ? error.message
          : 'Unable to return you to the queue right now.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="patient-page-shell">
      <header className="patient-site-header">
        <Link className="patient-clinic-brand" to="/" aria-label="Clinic Queueing home">
          <span className="patient-clinic-mark" aria-hidden="true">+</span>
          <span>
            <strong>{dashboard?.practiceLocation.name ?? 'Clinic Queueing'}</strong>
            <small>Patient queue</small>
          </span>
        </Link>
        {viewState === 'ready' ? (
          <button className="patient-menu-button" type="button" onClick={() => void load()} aria-label="Refresh queue status">
            ↻
          </button>
        ) : null}
      </header>

      <div className="patient-page-body">
        {viewState === 'loading' ? (
          <section className="patient-system-state" aria-live="polite">
            <p className="eyebrow">Appointment</p>
            <h1>Loading your queue status…</h1>
          </section>
        ) : null}

        {viewState === 'inaccessible' ? (
          <section className="patient-system-state">
            <p className="eyebrow">Appointment</p>
            <h1>Appointment access is unavailable.</h1>
            <p>Use the approved recovery flow or contact the clinic if you need help.</p>
          </section>
        ) : null}

        {viewState === 'unavailable' || viewState === 'error' ? (
          <section className="patient-system-state">
            <p className="eyebrow">
              {viewState === 'unavailable' ? 'Temporarily unavailable' : 'Connection problem'}
            </p>
            <h1>
              {viewState === 'unavailable'
                ? 'Your appointment is still booked.'
                : 'We could not load your appointment.'}
            </h1>
            <p>{message}</p>
            <button className="secondary" type="button" onClick={() => void load()}>
              Try again
            </button>
          </section>
        ) : null}

        {viewState === 'ready' && dashboard && presentation ? (
          <article className="patient-dashboard-shell" aria-live="polite">
            <section className={`patient-status-banner patient-tone-${presentation.tone}`}>
              <span className="patient-status-icon" aria-hidden="true">●</span>
              <div>
                <h1>{presentation.title}</h1>
                <p>{presentation.detail}</p>
              </div>
              {isLiveQueue(dashboard.status, dashboard.clinicDayStatus) ? (
                <span className="patient-live-badge">LIVE</span>
              ) : null}
            </section>

            <section className="patient-shell-card patient-appointment-card" aria-labelledby="patient-appointment-heading">
              <h2 id="patient-appointment-heading">YOUR APPOINTMENT</h2>
              <div className="patient-appointment-grid">
                <div className="patient-queue-identity" aria-label={`Queue number ${dashboard.queueNumber}`}>
                  <span>Queue Number</span>
                  <strong>{formatPatientQueueNumber(dashboard.queueNumber)}</strong>
                </div>
                <div className="patient-appointment-facts">
                  <div>
                    <span>Service Date</span>
                    <strong>{formatServiceDate(dashboard.serviceDate)}</strong>
                  </div>
                  <div>
                    <span>Service</span>
                    <strong>—</strong>
                  </div>
                </div>
              </div>
            </section>

            <section className="patient-shell-card patient-queue-card" aria-labelledby="patient-queue-heading">
              <div className="patient-card-heading-row">
                <h2 id="patient-queue-heading">QUEUE STATUS</h2>
                <button className="patient-inline-refresh" type="button" onClick={() => void load()} aria-label="Refresh queue status">↻</button>
              </div>
              <div className="patient-queue-metrics">
                <div>
                  <span>Now Serving</span>
                  <strong>{dashboard.nowServingQueueNumber === null ? '—' : formatPatientQueueNumber(dashboard.nowServingQueueNumber)}</strong>
                </div>
                <div>
                  <span>People Ahead</span>
                  <strong>{dashboard.status === 'WAITING' ? (dashboard.patientsAhead ?? '—') : '—'}</strong>
                </div>
                <div>
                  <span>Estimated Wait</span>
                  <strong>—</strong>
                </div>
              </div>
              {dashboard.status === 'TEMPORARILY_ABSENT' ? (
                <p className="patient-queue-note">Not in queue.</p>
              ) : dashboard.clinicDayStatus === 'NOT_STARTED' ? (
                <p className="patient-queue-note">The queue will appear when the clinic starts.</p>
              ) : null}
            </section>

            <section className="patient-shell-card patient-action-area" aria-labelledby="patient-action-heading">
              <h2 id="patient-action-heading">ACTION AREA</h2>
              {dashboard.canUseImHere ? (
                <>
                  <button className="patient-im-here-button" type="button" disabled={submitting} onClick={() => void imHere()}>
                    {submitting ? 'RETURNING TO QUEUE…' : "I'M HERE"}
                  </button>
                  <p>Rejoin today’s queue.</p>
                </>
              ) : dashboard.status === 'TEMPORARILY_ABSENT' ? (
                <div className="patient-staff-assistance">
                  <strong>Please go to the reception desk for assistance.</strong>
                </div>
              ) : dashboard.status === 'CALLED' ? (
                <p>No action is needed. Please proceed to the clinic.</p>
              ) : ['COMPLETED', 'CANCELLED', 'NO_SHOW', 'EXPIRED', 'RESCHEDULED'].includes(dashboard.status) ? (
                <p>No further queue action is available.</p>
              ) : (
                <p>No action is needed right now. Please wait for your turn.</p>
              )}
            </section>

            {message ? <div className="patient-message" role="status">{message}</div> : null}

            <section className="patient-shell-card patient-today-card" aria-labelledby="patient-today-heading">
              <div>
                <h2 id="patient-today-heading">TODAY'S CLINIC</h2>
                <span>Scheduled Hours</span>
                <strong>—</strong>
              </div>
              <span className={`patient-clinic-state patient-tone-${presentation.tone}`}>{presentation.clinicState}</span>
            </section>
          </article>
        ) : null}
      </div>
    </main>
  );
}
