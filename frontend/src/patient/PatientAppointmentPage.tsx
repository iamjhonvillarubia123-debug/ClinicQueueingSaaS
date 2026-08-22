import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ApiError, apiRequest } from '../api/client';
import { formatQueueNumber } from '../presentation/queueNumber';

type AppointmentStatus =
  | 'WAITING'
  | 'CALLED'
  | 'SERVING'
  | 'TEMPORARILY_ABSENT'
  | 'OUT_FOR_PROCEDURE'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'NO_SHOW';

type ClinicDayStatus = 'NOT_STARTED' | 'STARTED' | 'CLOSED' | 'CANCELLED' | null;

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

function formatPatientName(name: AppointmentDashboard['patientName']) {
  return [name.firstName, name.middleName, name.lastName, name.suffix].filter(Boolean).join(' ') || 'Patient';
}

function formatServiceDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'long', day: 'numeric' }).format(date);
}

function statusCopy(status: AppointmentStatus, clinicDayStatus: ClinicDayStatus) {
  if (clinicDayStatus === 'NOT_STARTED') return ['Clinic has not started', 'Your Queue Number is already reserved. This page will update when the clinic starts.'];
  switch (status) {
    case 'WAITING': return ['You are in the queue', 'Keep this page available on this device. Your Queue Number will not change.'];
    case 'CALLED': return ['Please proceed when ready', 'The clinic has called your Queue Number.'];
    case 'SERVING': return ['You are being served', 'Your appointment is currently in service.'];
    case 'TEMPORARILY_ABSENT': return ['You were marked temporarily absent', 'If the I’m Here action is available below, you may use it once to return to the queue. Otherwise, please approach clinic staff.'];
    case 'OUT_FOR_PROCEDURE': return ['You are out for a procedure', 'Clinic staff will return you to the queue when appropriate. Your Queue Number stays the same.'];
    case 'COMPLETED': return ['Appointment completed', 'This appointment has been completed.'];
    case 'CANCELLED': return ['Appointment cancelled', 'This appointment is no longer active.'];
    case 'NO_SHOW': return ['Appointment marked no-show', 'Please contact the clinic if you need assistance.'];
    default: return ['Appointment status', 'Your appointment information is shown below.'];
  }
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
      const result = await apiRequest<AppointmentDashboard>(`/patient-bookings/${encodeURIComponent(bookingReference)}/dashboard`);
      setDashboard(result);
      setViewState('ready');
    } catch (error) {
      setDashboard(null);
      if (error instanceof ApiError && error.status === 503) {
        setMessage('This online service is temporarily unavailable. Your existing appointment has not been cancelled. Please try again later.');
        setViewState('unavailable');
      } else if (error instanceof ApiError && (error.status === 401 || error.status === 403 || error.status === 404)) {
        setViewState('inaccessible');
      } else {
        setMessage(error instanceof ApiError ? error.message : 'Unable to load your appointment right now.');
        setViewState('error');
      }
    }
  }, [bookingReference]);

  useEffect(() => { void load(); }, [load]);

  const heading = useMemo(() => dashboard ? statusCopy(dashboard.status, dashboard.clinicDayStatus) : null, [dashboard]);

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
      setMessage('You are back in the queue. Your permanent Queue Number is unchanged.');
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : 'Unable to return you to the queue right now.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="public-detail patient-dashboard-page">
      <header className="public-header">
        <Link className="brand" to="/">Clinic Queueing</Link>
        {viewState === 'ready' ? <button className="text-button patient-refresh" type="button" onClick={() => void load()}>Refresh</button> : null}
      </header>

      {viewState === 'loading' ? (
        <section className="patient-dashboard patient-state" aria-live="polite"><p className="eyebrow">Appointment</p><h1>Loading your queue status…</h1></section>
      ) : null}

      {viewState === 'inaccessible' ? (
        <section className="patient-dashboard patient-state"><p className="eyebrow">Appointment</p><h1>Appointment access is unavailable.</h1><p>This device does not currently have access to this appointment. Use the approved recovery flow or contact the clinic if you need help.</p></section>
      ) : null}

      {viewState === 'unavailable' || viewState === 'error' ? (
        <section className="patient-dashboard patient-state"><p className="eyebrow">{viewState === 'unavailable' ? 'Temporarily unavailable' : 'Connection problem'}</p><h1>{viewState === 'unavailable' ? 'Your appointment is still booked.' : 'We could not load your appointment.'}</h1><p>{message}</p><button className="secondary" type="button" onClick={() => void load()}>Try again</button></section>
      ) : null}

      {viewState === 'ready' && dashboard && heading ? (
        <article className="patient-dashboard" aria-live="polite">
          <section className="patient-dashboard-hero">
            <p className="eyebrow">{dashboard.practiceLocation.name}</p>
            <h1>{heading[0]}</h1>
            <p>{heading[1]}</p>
          </section>

          <section className="patient-queue-number" aria-label={`Queue number ${dashboard.queueNumber}`}>
            <span>Your Queue Number</span>
            <strong>{formatQueueNumber(dashboard.queueNumber)}</strong>
          </section>

          <section className="patient-live-grid" aria-label="Live queue information">
            <div><span>Now serving</span><strong>{dashboard.nowServingQueueNumber === null ? '—' : formatQueueNumber(dashboard.nowServingQueueNumber)}</strong></div>
            <div><span>People ahead</span><strong>{dashboard.patientsAhead ?? '—'}</strong></div>
          </section>

          {dashboard.canUseImHere ? (
            <section className="patient-action-panel">
              <div><h2>I’m here</h2><p>Use this once if you have returned after being marked temporarily absent. Your Queue Number stays the same.</p></div>
              <button className="primary" type="button" disabled={submitting} onClick={() => void imHere()}>{submitting ? 'Returning to queue…' : 'I’m here'}</button>
            </section>
          ) : dashboard.status === 'TEMPORARILY_ABSENT' ? (
            <section className="patient-action-panel"><div><h2>Need to return to the queue?</h2><p>Please approach clinic staff for assistance. Self-service reinsertion is not available for this appointment.</p></div></section>
          ) : null}

          {message ? <div className="patient-message" role="status">{message}</div> : null}

          <section className="patient-details" aria-labelledby="appointment-details-heading">
            <h2 id="appointment-details-heading">Appointment details</h2>
            <dl>
              <div><dt>Patient</dt><dd>{formatPatientName(dashboard.patientName)}</dd></div>
              <div><dt>Clinic</dt><dd>{dashboard.practiceLocation.name}</dd></div>
              <div><dt>Date</dt><dd>{formatServiceDate(dashboard.serviceDate)}</dd></div>
              <div><dt>Booking reference</dt><dd>{dashboard.bookingReference}</dd></div>
              <div><dt>Status</dt><dd>{dashboard.status.replaceAll('_', ' ').toLowerCase()}</dd></div>
            </dl>
          </section>
        </article>
      ) : null}
    </main>
  );
}
