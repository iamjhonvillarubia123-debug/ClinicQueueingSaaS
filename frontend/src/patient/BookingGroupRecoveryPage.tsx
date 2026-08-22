import { FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ApiError, apiRequest } from '../api/client';

type BookingConfiguration = {
  practiceLocation: {
    id: string;
    publicIdentifier: string;
    name: string;
  };
};

type RecoveryRequestResult = {
  message: string;
  recoveryAttemptId: string;
  expiresAt: string;
};

type Stage = 'details' | 'otp';

function messageFor(error: unknown) {
  return error instanceof ApiError ? error.message : 'Unable to continue recovery right now. Please try again.';
}

export function BookingGroupRecoveryPage() {
  const { publicIdentifier } = useParams();
  const navigate = useNavigate();
  const [configuration, setConfiguration] = useState<BookingConfiguration | null>(null);
  const [loading, setLoading] = useState(true);
  const [stage, setStage] = useState<Stage>('details');
  const [serviceDate, setServiceDate] = useState('');
  const [mobileNumber, setMobileNumber] = useState('');
  const [otp, setOtp] = useState('');
  const [recoveryAttemptId, setRecoveryAttemptId] = useState('');
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
      const result = await apiRequest<RecoveryRequestResult>('/patient-booking-groups/recovery/request', {
        method: 'POST',
        body: {
          practiceLocationId: configuration.practiceLocation.id,
          serviceDate,
          mobileNumber: mobileNumber.trim(),
        },
      });
      setRecoveryAttemptId(result.recoveryAttemptId);
      setOtp('');
      setNotice('If a matching group booking can be recovered, verification will continue. Enter the verification code sent to the controlling mobile number.');
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
      await apiRequest(`/patient-booking-groups/recovery/${encodeURIComponent(recoveryAttemptId)}/resend`, { method: 'POST' });
      setOtp('');
      setNotice('If recovery can continue, a new verification code has been sent.');
    } catch (caught) {
      setError(messageFor(caught));
    } finally {
      setBusy(false);
    }
  }

  async function verifyAndRestore(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!recoveryAttemptId || busy) return;
    setError('');
    if (!/^\d{6}$/.test(otp)) {
      setError('Enter the 6-digit verification code.');
      return;
    }
    setBusy(true);
    try {
      await apiRequest('/patient-booking-groups/recovery/verify', {
        method: 'POST',
        body: { recoveryAttemptId, otp },
      });
      await apiRequest(`/patient-booking-groups/recovery/${encodeURIComponent(recoveryAttemptId)}/complete`, {
        method: 'POST',
        headers: { 'Idempotency-Key': crypto.randomUUID() },
      });
      navigate('/patient-booking-groups', { replace: true });
    } catch (caught) {
      setError(messageFor(caught));
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return <main className="public-detail"><header className="public-header"><Link className="brand" to="/">Clinic Queueing</Link></header><section className="patient-dashboard patient-state"><p className="eyebrow">Group recovery</p><h1>Preparing secure recovery…</h1></section></main>;
  }

  if (!configuration || !publicIdentifier) {
    return (
      <main className="public-detail">
        <header className="public-header"><Link className="brand" to="/">Clinic Queueing</Link></header>
        <section className="patient-dashboard patient-state">
          <p className="eyebrow">Group recovery</p>
          <h1>Recovery is unavailable from this page.</h1>
          <p>Return to the clinic’s public page and try again. Existing appointments are not cancelled by this message.</p>
          <Link className="secondary-action" to="/">Return home</Link>
        </section>
      </main>
    );
  }

  return (
    <main className="public-detail">
      <header className="public-header">
        <Link className="brand" to="/">Clinic Queueing</Link>
        <Link className="quiet-link" to={`/public/practice-locations/${encodeURIComponent(publicIdentifier)}`}>Back to clinic</Link>
      </header>
      <article className="patient-dashboard recovery-page">
        <header className="patient-dashboard-hero">
          <p className="eyebrow">Group booking recovery</p>
          <h1>{stage === 'details' ? 'Recover access to your group booking.' : 'Verify the controlling mobile.'}</h1>
          <p>{stage === 'details'
            ? `Use the same clinic, service date, and controlling mobile number used for the group booking at ${configuration.practiceLocation.name}.`
            : 'Verification restores secure controller access to the existing booking. It does not create another appointment or change anyone’s Queue Number.'}</p>
        </header>

        {stage === 'details' ? (
          <form className="recovery-form" onSubmit={requestRecovery}>
            <label>Service date<input type="date" required value={serviceDate} onChange={(event) => setServiceDate(event.target.value)} /></label>
            <label>Controlling mobile number<input type="tel" inputMode="tel" autoComplete="tel" required maxLength={30} placeholder="09… or +63…" value={mobileNumber} onChange={(event) => setMobileNumber(event.target.value)} /></label>
            <p className="field-note">For privacy, this page does not confirm whether a matching booking exists before successful verification.</p>
            {error ? <div className="form-error" role="alert">{error}</div> : null}
            <button className="primary" type="submit" disabled={busy || !serviceDate || !mobileNumber.trim()}>{busy ? 'Checking…' : 'Continue to verification'}</button>
          </form>
        ) : (
          <form className="recovery-form" onSubmit={verifyAndRestore}>
            {notice ? <div className="patient-message" role="status">{notice}</div> : null}
            <label>6-digit verification code<input inputMode="numeric" autoComplete="one-time-code" maxLength={6} pattern="[0-9]{6}" required value={otp} onChange={(event) => setOtp(event.target.value.replace(/\D/g, '').slice(0, 6))} /></label>
            {error ? <div className="form-error" role="alert">{error}</div> : null}
            <button className="primary" type="submit" disabled={busy || otp.length !== 6}>{busy ? 'Restoring access…' : 'Restore group access'}</button>
            <div className="recovery-secondary-actions">
              <button className="secondary" type="button" disabled={busy} onClick={() => void resend()}>Send a new code</button>
              <button className="text-button" type="button" disabled={busy} onClick={() => { setStage('details'); setRecoveryAttemptId(''); setOtp(''); setNotice(''); setError(''); }}>Change details</button>
            </div>
          </form>
        )}
      </article>
    </main>
  );
}
