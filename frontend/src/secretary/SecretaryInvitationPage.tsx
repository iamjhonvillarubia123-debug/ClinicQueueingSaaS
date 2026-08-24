import { FormEvent, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ApiError, apiRequest } from '../api/client';

type InvitationPreview = {
  valid: true;
  firstName: string;
  clinicName: string;
  expiresAt: string;
};

function errorMessage(error: unknown) {
  return error instanceof ApiError ? error.message : 'This invitation link is invalid or no longer available.';
}

export function SecretaryInvitationPage() {
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
      setError('This invitation link is invalid or incomplete.');
      return () => { active = false; };
    }
    void apiRequest<InvitationPreview>('/secretary/invitations/inspect', {
      method: 'POST',
      body: { token },
    })
      .then((result) => {
        if (active) setPreview(result);
      })
      .catch((caught) => {
        if (active) setError(errorMessage(caught));
      })
      .finally(() => {
        if (active) setChecking(false);
      });
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
      await apiRequest('/secretary/invitations/accept', {
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
      <section className="auth-panel" aria-labelledby="secretary-invitation-heading">
        <Link className="brand" to="/">Clinic Queueing</Link>
        <div className="auth-heading">
          <p className="eyebrow">Secretary invitation</p>
          <h1 id="secretary-invitation-heading">{complete ? 'Account ready' : 'Join the clinic'}</h1>
          {checking ? <p>Checking your secure invitation…</p> : null}
          {!checking && preview && !complete ? <p>{preview.firstName}, you were invited to join <strong>{preview.clinicName}</strong>. Choose your own password to accept the invitation.</p> : null}
          {complete ? <p>Your Secretary account and clinic assignment were created together. Sign in with the password you just chose.</p> : null}
        </div>

        {error ? <div className="form-error" role="alert">{error}</div> : null}
        {preview && !complete ? (
          <form className="stack" onSubmit={accept}>
            <label>Password<input required type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
            <label>Confirm password<input required type="password" autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} /></label>
            <button className="primary" type="submit" disabled={busy}>{busy ? 'Accepting invitation…' : 'Accept invitation'}</button>
          </form>
        ) : null}
        {complete ? <Link className="primary-action auth-full-action" to="/login">Continue to sign in</Link> : null}
        {!checking && !preview && !complete ? <Link className="secondary-action auth-full-action" to="/login">Return to sign in</Link> : null}
      </section>
    </main>
  );
}
