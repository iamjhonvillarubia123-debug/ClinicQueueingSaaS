import { FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ApiError, apiRequest } from '../api/client';

type BookingConfiguration = {
  practiceLocation: {
    publicIdentifier: string;
    name: string;
  };
};

type RecoveryRequestResult = {
  recoveryAttemptId: string;
  expiresAt: string;
};

type IndividualCandidate = {
  bookingReference: string;
  queueNumber: number;
  serviceDate: string;
  firstName: string | null;
  lastName: string | null;
  practiceLocationName: string | null;
};

type GroupCandidate = {
  bookingGroupId: string;
  serviceDate: string;
  practiceLocationName: string | null;
  appointments: Array<{
    bookingReference: string;
    queueNumber: number;
    firstName: string | null;
    lastName: string | null;
    status: string;
  }>;
};

type VerifyResult = {
  verified: boolean;
  recoveryAttemptId: string;
  contextKind: 'INDIVIDUAL' | 'BOOKING_GROUP' | null;
  candidate: IndividualCandidate | GroupCandidate | null;
};

type UseExistingResult = {
  contextKind: 'INDIVIDUAL' | 'BOOKING_GROUP';
  bookingReference?: string;
  bookingGroupId?: string;
};

type ReplacementResult = {
  replacementAuthorized: true;
  replacementRecoveryAttemptId: string;
  expiresAt: string;
};

type Stage = 'details' | 'otp' | 'candidate' | 'replace-confirm' | 'replacement-ready';

function messageFor(error: unknown) {
  return error instanceof ApiError
    ? error.message
    : 'Unable to continue recovery right now. Please try again.';
}

function dateOnly(value: string) {
  return value.slice(0, 10);
}

function formatServiceDateLong(value: string) {
  const [year, month, day] = dateOnly(value).split('-').map(Number);
  if (!year || !month || !day) return value;
  return new Intl.DateTimeFormat('en-PH', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

function personName(firstName: string | null, lastName: string | null) {
  return [firstName, lastName].filter(Boolean).join(' ') || 'Patient';
}

function isGroupCandidate(candidate: IndividualCandidate | GroupCandidate): candidate is GroupCandidate {
  return 'appointments' in candidate;
}

export function BookingRecoveryPage() {
  const { publicIdentifier } = useParams();
  const navigate = useNavigate();
  const [configuration, setConfiguration] = useState<BookingConfiguration | null>(null);
  const [loading, setLoading] = useState(true);
  const [stage, setStage] = useState<Stage>('details');
  const [serviceDate, setServiceDate] = useState('');
  const [mobileNumber, setMobileNumber] = useState('');
  const [otp, setOtp] = useState('');
  const [recoveryAttemptId, setRecoveryAttemptId] = useState('');
  const [candidate, setCandidate] = useState<IndividualCandidate | GroupCandidate | null>(null);
  const [contextKind, setContextKind] = useState<'INDIVIDUAL' | 'BOOKING_GROUP' | null>(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    if (!publicIdentifier) {
      setLoading(false);
      return () => { active = false; };
    }
    void apiRequest<BookingConfiguration>(`/booking/public/configuration/${encodeURIComponent(publicIdentifier)}`)
      .then((result) => { if (active) setConfiguration(result); })
      .catch(() => { if (active) setConfiguration(null); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [publicIdentifier]);

  async function requestRecovery(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!configuration || !serviceDate || !mobileNumber.trim() || busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await apiRequest<RecoveryRequestResult>('/patient-booking-recovery/request', {
        method: 'POST',
        body: {
          practiceLocationPublicIdentifier: configuration.practiceLocation.publicIdentifier,
          serviceDate,
          mobileNumber: mobileNumber.trim(),
        },
      });
      setRecoveryAttemptId(result.recoveryAttemptId);
      setOtp('');
      setNotice('If booking access can be recovered, enter the verification code sent to this mobile number.');
      setStage('otp');
    } catch (caught) {
      setError(messageFor(caught));
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    if (!recoveryAttemptId || busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await apiRequest(`/patient-booking-recovery/${encodeURIComponent(recoveryAttemptId)}/resend`, { method: 'POST' });
      setOtp('');
      setNotice('If recovery can continue, a new verification code has been sent.');
    } catch (caught) {
      setError(messageFor(caught));
    } finally {
      setBusy(false);
    }
  }

  async function verify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!recoveryAttemptId || busy) return;
    setError('');
    if (!/^\d{6}$/.test(otp)) {
      setError('Enter the 6-digit verification code.');
      return;
    }
    setBusy(true);
    try {
      const result = await apiRequest<VerifyResult>('/patient-booking-recovery/verify', {
        method: 'POST',
        body: { recoveryAttemptId, otp },
      });
      setContextKind(result.contextKind);
      setCandidate(result.candidate);
      setNotice('');
      setStage('candidate');
    } catch (caught) {
      setError(messageFor(caught));
    } finally {
      setBusy(false);
    }
  }

  async function useExisting() {
    if (!recoveryAttemptId || !candidate || busy) return;
    setBusy(true);
    setError('');
    try {
      const result = await apiRequest<UseExistingResult>(`/patient-booking-recovery/${encodeURIComponent(recoveryAttemptId)}/use-existing`, {
        method: 'POST',
        headers: { 'Idempotency-Key': crypto.randomUUID() },
      });
      if (result.contextKind === 'BOOKING_GROUP') {
        navigate('/patient-booking-groups', { replace: true });
        return;
      }
      if (result.bookingReference) {
        navigate(`/patient-bookings/${encodeURIComponent(result.bookingReference)}`, { replace: true });
      }
    } catch (caught) {
      setError(messageFor(caught));
    } finally {
      setBusy(false);
    }
  }

  async function replaceExisting() {
    if (!recoveryAttemptId || !candidate || !publicIdentifier || busy) return;
    setBusy(true);
    setError('');
    try {
      const result = await apiRequest<ReplacementResult>(`/patient-booking-recovery/${encodeURIComponent(recoveryAttemptId)}/replace-existing`, {
        method: 'POST',
      });
      sessionStorage.setItem(`f4-replacement:${publicIdentifier}`, JSON.stringify({
        recoveryAttemptId: result.replacementRecoveryAttemptId,
        serviceDate,
        mobileNumber: mobileNumber.trim(),
        expiresAt: result.expiresAt,
      }));
      setStage('replacement-ready');
    } catch (caught) {
      setError(messageFor(caught));
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return <main className="public-detail"><header className="public-header"><Link className="brand" to="/">Clinic Queueing</Link></header><section className="patient-dashboard patient-state"><p className="eyebrow">Booking recovery</p><h1>Preparing secure recovery…</h1></section></main>;
  }

  if (!configuration || !publicIdentifier) {
    return <main className="public-detail"><header className="public-header"><Link className="brand" to="/">Clinic Queueing</Link></header><section className="patient-dashboard patient-state"><p className="eyebrow">Booking recovery</p><h1>Recovery is unavailable from this page.</h1><p>Return to the clinic’s public page and try again. No existing booking is changed by this message.</p><Link className="secondary-action" to="/">Return home</Link></section></main>;
  }

  const candidateDate = candidate ? formatServiceDateLong(candidate.serviceDate) : formatServiceDateLong(serviceDate);

  return (
    <main className="public-detail">
      <header className="public-header">
        <Link className="brand" to="/">Clinic Queueing</Link>
        <Link className="quiet-link" to={`/public/practice-locations/${encodeURIComponent(publicIdentifier)}`}>Back to clinic</Link>
      </header>
      <article className="patient-dashboard recovery-page">
        <header className="patient-dashboard-hero">
          <p className="eyebrow">Recover booking access</p>
          <h1>{stage === 'details' ? 'Recover your booking.' : stage === 'otp' ? 'Verify your mobile.' : stage === 'candidate' ? 'Is this your booking?' : stage === 'replace-confirm' ? 'Create a new booking?' : 'Existing booking cancelled.'}</h1>
          <p>{stage === 'details'
            ? `Use the service date and mobile number used for the booking at ${configuration.practiceLocation.name}. You do not need to know whether it was an individual or group booking.`
            : stage === 'otp'
              ? 'For privacy, booking details stay hidden until the mobile number is verified.'
              : stage === 'candidate'
                ? 'Choose the existing booking if it belongs to you. Rejecting it does not cancel anything until you confirm the next warning.'
                : stage === 'replace-confirm'
                  ? 'This action permanently gives up the old live queue position. The old Queue Number remains historical and will not transfer.'
                  : 'You can now create a new booking. The replacement will receive fresh Queue Number(s) from the current queue when confirmation succeeds.'}</p>
        </header>

        {stage === 'details' ? (
          <form className="recovery-form" onSubmit={requestRecovery}>
            <label>Service date<input type="date" required value={serviceDate} onChange={(event) => setServiceDate(event.target.value)} /></label>
            <label>Mobile number<input type="tel" inputMode="tel" autoComplete="tel" required maxLength={30} placeholder="09… or +63…" value={mobileNumber} onChange={(event) => setMobileNumber(event.target.value)} /></label>
            <p className="field-note">For privacy, this page does not confirm whether a booking exists before successful verification.</p>
            {error ? <div className="form-error" role="alert">{error}</div> : null}
            <button className="primary" type="submit" disabled={busy || !serviceDate || !mobileNumber.trim()}>{busy ? 'Checking…' : 'Continue to verification'}</button>
          </form>
        ) : null}

        {stage === 'otp' ? (
          <form className="recovery-form" onSubmit={verify}>
            {notice ? <div className="patient-message" role="status">{notice}</div> : null}
            <label>6-digit verification code<input inputMode="numeric" autoComplete="one-time-code" maxLength={6} pattern="[0-9]{6}" required value={otp} onChange={(event) => setOtp(event.target.value.replace(/\D/g, '').slice(0, 6))} /></label>
            {error ? <div className="form-error" role="alert">{error}</div> : null}
            <button className="primary" type="submit" disabled={busy || otp.length !== 6}>{busy ? 'Verifying…' : 'Verify code'}</button>
            <div className="recovery-secondary-actions">
              <button className="secondary" type="button" disabled={busy} onClick={() => void resend()}>Send a new code</button>
              <button className="text-button" type="button" disabled={busy} onClick={() => { setStage('details'); setRecoveryAttemptId(''); setOtp(''); setNotice(''); setError(''); }}>Change details</button>
            </div>
          </form>
        ) : null}

        {stage === 'candidate' ? (
          candidate ? (
            <section className="recovery-candidate" aria-labelledby="candidate-heading">
              <h2 id="candidate-heading">Booking details</h2>
              <dl className="patient-detail-list">
                <div><dt>Clinic</dt><dd>{candidate.practiceLocationName ?? configuration.practiceLocation.name}</dd></div>
                <div><dt>Service date</dt><dd>{candidateDate}</dd></div>
                {isGroupCandidate(candidate) ? (
                  <div><dt>People</dt><dd>{candidate.appointments.map((appointment) => `${personName(appointment.firstName, appointment.lastName)} · Queue ${appointment.queueNumber}`).join(', ')}</dd></div>
                ) : (
                  <>
                    <div><dt>Patient</dt><dd>{personName(candidate.firstName, candidate.lastName)}</dd></div>
                    <div><dt>Booking reference</dt><dd>{candidate.bookingReference}</dd></div>
                    <div><dt>Queue Number</dt><dd>{candidate.queueNumber}</dd></div>
                  </>
                )}
              </dl>
              {error ? <div className="form-error" role="alert">{error}</div> : null}
              <div className="recovery-candidate-actions">
                <button className="primary" type="button" disabled={busy} onClick={() => void useExisting()}>{busy ? 'Restoring access…' : 'This is my booking'}</button>
                <button className="secondary" type="button" disabled={busy} onClick={() => { setError(''); setStage('replace-confirm'); }}>This is not my booking</button>
              </div>
            </section>
          ) : (
            <section className="patient-state">
              <h2>No booking can be shown from this recovery attempt.</h2>
              <p>No booking or Queue Number has been changed.</p>
            </section>
          )
        ) : null}

        {stage === 'replace-confirm' && candidate ? (
          <section className="patient-state" aria-labelledby="replacement-warning-heading">
            <h2 id="replacement-warning-heading">Cancel the existing booking and start again?</h2>
            <p>The existing booking at {configuration.practiceLocation.name} on {candidateDate} will be cancelled. Its old Queue Number and queue position will not transfer. Your new booking will be treated as a new queue entry and will receive new Queue Number(s) based on the queue when the new booking is successfully confirmed.</p>
            {error ? <div className="form-error" role="alert">{error}</div> : null}
            <div className="recovery-candidate-actions">
              <button className="secondary" type="button" disabled={busy} onClick={() => { setError(''); setStage('candidate'); }}>Keep existing booking</button>
              <button className="primary" type="button" disabled={busy} onClick={() => void replaceExisting()}>{busy ? 'Cancelling…' : 'Cancel existing booking and create new one'}</button>
            </div>
          </section>
        ) : null}

        {stage === 'replacement-ready' ? (
          <section className="patient-state">
            <p>No second verification code is required while this verified replacement session remains valid.</p>
            <div className="recovery-candidate-actions">
              <Link className="primary-action" to={`/book/${encodeURIComponent(publicIdentifier)}`}>Book one person</Link>
              <Link className="secondary-action" to={`/book/${encodeURIComponent(publicIdentifier)}/group`}>Book multiple people</Link>
            </div>
          </section>
        ) : null}
      </article>
    </main>
  );
}
