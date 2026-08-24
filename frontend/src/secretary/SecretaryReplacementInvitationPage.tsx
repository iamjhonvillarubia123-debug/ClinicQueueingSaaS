import { FormEvent, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ApiError, apiRequest } from '../api/client';

type InvitationPreview = {
  valid: true;
  firstName: string;
  clinicName: string;
  expiresAt: string;
  accessProfile: 'STANDARD' | 'FULL_CLINIC_CONFIGURATION' | 'CUSTOM';
};

function errorMessage(error: unknown) {
  return error instanceof ApiError ? error.message : 'This replacement invitation is invalid or no longer available.';
}

export function SecretaryReplacementInvitationPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token')?.trim() ?? '';
  const [preview, setPreview] = useState<InvitationPreview | null>(null);
  const [checking, setChecking] = useState(true);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [complete, setComplete] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    if (!token) {
      setChecking(false);
      setError('This replacement invitation link is invalid or incomplete.');
      return () => { active = false; };
    }
    void apiRequest<InvitationPreview>('/secretary/replacement-invitations/inspect', {
      method: 'POST',
      body: { token },
    })
      .then((result) => { if (active) setPreview(result); })
      .catch((caught) => { if (active) setError(errorMessage(caught)); })
      .finally(() => { if (active) setChecking(false); });
    return () => { active = false; };
  }, [token]);

  async function accept(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    if (!password.trim()) {
      setError('Password must not be blank.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    setBusy(true);
    try {
      await apiRequest('/secretary/replacement-invitations/accept', {
        method: 'POST',
        body: { token, password },
      });
      setComplete(true);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-panel" aria-labelledby="replacement-invitation-heading">
        <Link className="brand" to="/">Clinic Queueing</Link>
        <div className="auth-heading">
          <p className="eyebrow">Secretary replacement onboarding</p>
          <h1 id="replacement-invitation-heading">{complete ? 'Account ready for Doctor confirmation' : 'Complete your onboarding'}</h1>
          {checking ? <p>Checking your secure replacement invitation…</p> : null}
          {!checking && preview && !complete ? <p>{preview.firstName}, you were invited as a planned replacement Secretary for <strong>{preview.clinicName}</strong>. Create your password now. This step does not give you access to that clinic.</p> : null}
          {complete ? <p>Your Secretary account is ready, but the current Secretary still controls the clinic. The Doctor must confirm the replacement with their current password before clinic access transfers to you.</p> : null}
        </div>

        {error ? <div className="form-error" role="alert">{error}</div> : null}
        {preview && !complete ? (
          <form className="stack" onSubmit={accept}>
            <label>Password<input required type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
            <label>Confirm password<input required type="password" autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} /></label>
            <button className="primary" type="submit" disabled={busy}>{busy ? 'Completing onboarding…' : 'Create Secretary account'}</button>
          </form>
        ) : null}
        {complete ? <Link className="primary-action auth-full-action" to="/login">Continue to sign in</Link> : null}
        {!checking && !preview && !complete ? <Link className="secondary-action auth-full-action" to="/login">Return to sign in</Link> : null}
      </section>
    </main>
  );
}
