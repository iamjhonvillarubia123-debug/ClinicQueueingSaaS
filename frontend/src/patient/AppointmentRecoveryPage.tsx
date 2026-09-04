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
};

type RecoveryCandidate = {
  bookingReference: string;
  queueNumber: number;
  serviceDate: string;
  firstName: string | null;
  lastName: string | null;
  practiceLocationName: string | null;
};

type VerifyResult = {
  verified: boolean;
  recoveryAttemptId: string;
  candidate: RecoveryCandidate | null;
};

type ConfirmResult = {
  bookingReference: string;
  queueNumber: number;
};

type Stage = 'details' | 'otp' | 'candidate' | 'rejected';

function messageFor(error: unknown) {
  return error instanceof ApiError
    ? error.message
    : 'Unable to continue recovery right now. Please try again.';
}

function candidateName(candidate: RecoveryCandidate) {
  return [candidate.firstName, candidate.lastName].filter(Boolean).join(' ') || 'Patient';
}

export function AppointmentRecoveryPage() {
  const { publicIdentifier } = useParams();
  const navigate = useNavigate();
  const [configuration, setConfiguration] = useState<BookingConfiguration | null>(null);
  const [loading, setLoading] = useState(true);
  const [stage, setStage] = useState<Stage>('details');
  const [serviceDate, setServiceDate] = useState('');
  const [mobileNumber, setMobileNumber] = useState('');
  const [otp, setOtp] = useState('');
  const [recoveryAttemptId, setRecoveryAttemptId] = useState('');
  const [candidate, setCandidate] = useState<RecoveryCandidate | null>(null);
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
      const result = await apiRequest<RecoveryRequestResult>('/patient-bookings/recovery/request', {
        method: 'POST',
        body: {
          practiceLocationPublicIdentifier: configuration.practiceLocation.publicIdentifier,
          serviceDate,
          mobileNumber: mobileNumber.trim(),
        },
      });
      setRecoveryAttemptId(result.recoveryAttemptId);
      setOtp('');
      setNotice('If an eligible appointment can be recovered, enter the verification code sent to the mobile number.');
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
      await apiRequest(`/patient-bookings/recovery/${encodeURIComponent(recoveryAttemptId)}/resend`, { method: 'POST' });
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
      const result = await apiRequest<VerifyResult>('/patient-bookings/recovery/verify', {
        method: 'POST',
        body: { recoveryAttemptId, otp },
      });
      setCandidate(result.candidate);
      setStage('candidate');
      setNotice('');
    } catch (caught) {
      setError(messageFor(caught));
    } finally {
      setBusy(false);
    }
  }

  async function confirmCandidate() {
    if (!recoveryAttemptId || !candidate || busy) return;
    setBusy(true);
    setError('');
    try {
      const result = await apiRequest<ConfirmResult>(`/patient-bookings/recovery/${encodeURIComponent(recoveryAttemptId)}/confirm`, {
        method: 'POST',
        headers: { 'Idempotency-Key': crypto.randomUUID() },
      });
      navigate(`/patient-bookings/${encodeURIComponent(result.bookingReference)}`, { replace: true });
    } catch (caught) {
      setError(messageFor(caught));
    } finally {
      setBusy(false);
    }
  }

  async function rejectCandidate() {
    if (!recoveryAttemptId || busy) return;
    setBusy(true);
    setError('');
    try {
      await apiRequest(`/patient-bookings/recovery/${encodeURIComponent(recoveryAttemptId)}/reject`, { method: 'POST' });
      setStage('rejected');
    } catch (caught) {
      setError(messageFor(caught));
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return <main className="public-detail"><header className="public-header"><Link className="brand" to="/">Clinic Queueing</Link></header><section className="patient-dashboard patient-state"><p className="eyebrow">Appointment recovery</p><h1>Preparing secure recovery…</h1></section></main>;
  }

  if (!configuration || !publicIdentifier) {
    return <main className="public-detail"><header className="public-header"><Link className="brand" to="/">Clinic Queueing</Link></header><section className="patient-dashboard patient-state"><p className="eyebrow">Appointment recovery</p><h1>Recovery is unavailable from this page.</h1><p>Return to the clinic’s public page and try again. Existing appointments are not cancelled by this message.</p><Link className="secondary-action" to="/">Return home</Link></section></main>;
  }

  return (
    <main className="public-detail">
      <header className="public-header">
        <Link className="brand" to="/">Clinic Queueing</Link>
        <Link className="quiet-link" to={`/public/practice-locations/${encodeURIComponent(publicIdentifier)}`}>Back to clinic</Link>
      </header>
      <article className="patient-dashboard recovery-page">
        <header className="patient-dashboard-hero">
          <p className="eyebrow">Appointment recovery</p>
          <h1>{stage === 'details' ? 'Recover access to your appointment.' : stage === 'otp' ? 'Verify your mobile.' : stage === 'candidate' ? 'Is this your booking?' : 'No booking was changed.'}</h1>
          <p>{stage === 'details'
            ? `Use the clinic, service date, and mobile number used for the individual booking at ${configuration.practiceLocation.name}.`
            : stage === 'otp'
              ? 'No appointment details are shown until the mobile number is verified.'
              : stage === 'candidate'
                ? 'Confirm the booking only if these details belong to you.'
                : 'The recovery attempt ended without changing the appointment or its Queue Number.'}</p>
        </header>

        {stage === 'details' ? (
          <form className="recovery-form" onSubmit={requestRecovery}>
            <label>Service date<input type="date" required value={serviceDate} onChange={(event) => setServiceDate(event.target.value)} /></label>
            <label>Mobile number<input type="tel" inputMode="tel" autoComplete="tel" required maxLength={30} placeholder="09… or +63…" value={mobileNumber} onChange={(event) => setMobileNumber(event.target.value)} /></label>
            <p className="field-note">For privacy, this page does not confirm whether a matching appointment exists before successful verification.</p>
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
                <div><dt>Patient</dt><dd>{candidateName(candidate)}</dd></div>
                <div><dt>Clinic</dt><dd>{candidate.practiceLocationName ?? configuration.practiceLocation.name}</dd></div>
                <div><dt>Service date</dt><dd>{new Date(candidate.serviceDate).toLocaleDateString()}</dd></div>
                <div><dt>Booking reference</dt><dd>{candidate.bookingReference}</dd></div>
                <div><dt>Queue Number</dt><dd>{candidate.queueNumber}</dd></div>
              </dl>
              {error ? <div className="form-error" role="alert">{error}</div> : null}
              <div className="recovery-candidate-actions">
                <button className="primary" type="button" disabled={busy} onClick={() => void confirmCandidate()}>{busy ? 'Restoring access…' : 'This is my booking'}</button>
                <button className="secondary" type="button" disabled={busy} onClick={() => void rejectCandidate()}>This is not my booking</button>
              </div>
            </section>
          ) : (
            <section className="patient-state">
              <h2>No booking can be shown from this recovery attempt.</h2>
              <p>Contact the clinic if you still need help locating your appointment. No appointment or Queue Number has been changed.</p>
            </section>
          )
        ) : null}

        {stage === 'rejected' ? (
          <section className="patient-state">
            <p>Contact the clinic if you still need help locating your appointment. The rejected candidate was not modified.</p>
            <Link className="secondary-action" to={`/public/practice-locations/${encodeURIComponent(publicIdentifier)}`}>Return to clinic</Link>
          </section>
        ) : null}
      </article>
    </main>
  );
}
