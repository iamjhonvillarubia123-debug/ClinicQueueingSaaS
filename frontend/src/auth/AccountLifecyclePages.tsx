import { FormEvent, useMemo, useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { ApiError, apiRequest } from '../api/client';
import { useAuth } from './AuthContext';

type LifecycleRole = 'DOCTOR' | 'SECRETARY';

function idempotencyKey(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function roleFromQuery(value: string | null): LifecycleRole | null {
  return value === 'DOCTOR' || value === 'SECRETARY' ? value : null;
}

function lifecycleBase(role: LifecycleRole) {
  return role === 'DOCTOR' ? '/doctor/account' : '/secretary/account';
}

function friendlyRole(role: LifecycleRole) {
  return role === 'DOCTOR' ? 'Doctor' : 'Secretary';
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof ApiError ? error.message : fallback;
}

function permanentClosureErrorMessage(error: unknown) {
  if (error instanceof ApiError && error.status === 401) {
    return 'Email or current password is incorrect.';
  }
  return errorMessage(error, 'Unable to permanently close the account.');
}

export function AccountSecurityPage() {
  const { profile, refresh } = useAuth();
  const navigate = useNavigate();
  const [confirmDisable, setConfirmDisable] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const role = profile?.role === 'DOCTOR' || profile?.role === 'SECRETARY' ? profile.role : null;
  if (profile?.role === 'SYSTEM_ADMIN') return <Navigate to="/app" replace />;
  if (!role) return null;

  async function disableAccount(targetRole: LifecycleRole) {
    if (!currentPassword.trim()) return;
    setSubmitting(true);
    setError('');
    try {
      await apiRequest(`${lifecycleBase(targetRole)}/disable`, {
        method: 'POST',
        headers: { 'Idempotency-Key': idempotencyKey('disable-account') },
        body: { currentPassword },
      });
      setCurrentPassword('');
      await refresh();
      navigate(`/account/disabled?role=${targetRole}`, { replace: true });
    } catch (caught) {
      setError(errorMessage(caught, 'Unable to disable the account. Please check your password and try again.'));
      setSubmitting(false);
    }
  }

  return (
    <section className="account-page" aria-labelledby="account-heading">
      <div className="account-title-row">
        <div>
          <p className="eyebrow">Account & security</p>
          <h1 id="account-heading">Your account</h1>
          <p>Manage sign-in recovery and your voluntary account lifecycle.</p>
        </div>
      </div>

      <section className="settings-section" aria-labelledby="security-heading">
        <h2 id="security-heading">Security</h2>
        <div className="settings-row">
          <div><strong>Password</strong><span>Password replacement is completed through your verified email and signs out existing sessions.</span></div>
          <Link className="secondary-action" to="/forgot-password">Reset password</Link>
        </div>
      </section>

      <section className="settings-section" aria-labelledby="disable-heading">
        <h2 id="disable-heading">Disable account</h2>
        <p className="settings-copy">
          Disabling stops ordinary access immediately and signs this account out. You can reactivate later with your email and password, but reactivation does not restore a session automatically.
        </p>
        {role === 'SECRETARY' ? (
          <p className="settings-copy">Your current clinic assignments and exceptional capabilities are removed when the account is disabled. Reactivation does not restore them automatically.</p>
        ) : null}
        {!confirmDisable ? (
          <button className="secondary danger-action" type="button" onClick={() => setConfirmDisable(true)}>Disable my account</button>
        ) : (
          <div className="confirm-panel" role="group" aria-label="Confirm account disablement">
            <strong>Disable this account now?</strong>
            <p>You will be signed out immediately. Existing appointments are not renumbered or automatically cancelled by this account action.</p>
            <label>Current password<input type="password" autoComplete="current-password" required value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} /></label>
            {error ? <div className="form-error" role="alert">{error}</div> : null}
            <div className="button-row">
              <button className="primary danger-primary" type="button" disabled={submitting || !currentPassword.trim()} onClick={() => void disableAccount(role)}>{submitting ? 'Disabling…' : 'Yes, disable my account'}</button>
              <button className="secondary" type="button" disabled={submitting} onClick={() => { setConfirmDisable(false); setCurrentPassword(''); setError(''); }}>Keep account active</button>
            </div>
          </div>
        )}
      </section>

      <section className="settings-section permanent-zone" aria-labelledby="closure-heading">
        <h2 id="closure-heading">Permanent account closure</h2>
        <p className="settings-copy">Permanent closure cannot be undone. It is a separate workflow from temporary disablement.</p>
        <Link className="quiet-link" to={`/account/permanent-close?role=${role}`}>Review permanent closure</Link>
      </section>
    </section>
  );
}

export function DisabledAccountPage() {
  const [params] = useSearchParams();
  const role = roleFromQuery(params.get('role'));
  return (
    <main className="auth-page">
      <section className="auth-panel">
        <Link className="brand" to="/">Clinic Queueing</Link>
        <div className="auth-heading">
          <p className="eyebrow">Account disabled</p>
          <h1>Your account is disabled.</h1>
          <p>Ordinary access has stopped and active sessions have been revoked.</p>
        </div>
        <div className="stack">
          <Link className="primary-action" to={`/account/reactivate${role ? `?role=${role}` : ''}`}>Reactivate account</Link>
          <Link className="secondary-action" to="/login">Return to sign in</Link>
        </div>
      </section>
    </main>
  );
}

export function ReactivateAccountPage() {
  const [params] = useSearchParams();
  const initialRole = roleFromQuery(params.get('role'));
  const [role, setRole] = useState<LifecycleRole>(initialRole ?? 'DOCTOR');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [complete, setComplete] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      await apiRequest(`${lifecycleBase(role)}/reactivate`, {
        method: 'POST',
        headers: { 'Idempotency-Key': idempotencyKey('reactivate-account') },
        body: { email, password },
      });
      setComplete(true);
    } catch (caught) {
      setError(errorMessage(caught, 'Unable to reactivate the account.'));
    } finally {
      setSubmitting(false);
    }
  }

  if (complete) {
    return (
      <main className="auth-page"><section className="auth-panel">
        <Link className="brand" to="/">Clinic Queueing</Link>
        <div className="auth-heading"><p className="eyebrow">Reactivated</p><h1>Account reactivated.</h1><p>Reactivation does not sign you in or restore previous Secretary assignments. Sign in again to start a new session.</p></div>
        <Link className="primary-action" to="/login">Sign in</Link>
      </section></main>
    );
  }

  return (
    <main className="auth-page"><section className="auth-panel" aria-labelledby="reactivate-heading">
      <Link className="brand" to="/">Clinic Queueing</Link>
      <div className="auth-heading"><p className="eyebrow">Reactivate account</p><h1 id="reactivate-heading">Restore account access</h1><p>Use the email and password for the voluntarily disabled account.</p></div>
      <form className="stack" onSubmit={submit}>
        <label>Account type<select value={role} onChange={(event) => setRole(event.target.value as LifecycleRole)}><option value="DOCTOR">Doctor</option><option value="SECRETARY">Secretary</option></select></label>
        <label>Email<input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></label>
        <label>Password<input type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} /></label>
        {error ? <div className="form-error" role="alert">{error}</div> : null}
        <button className="primary" type="submit" disabled={submitting || !email || !password}>{submitting ? 'Reactivating…' : `Reactivate ${friendlyRole(role)} account`}</button>
        <Link className="quiet-link auth-center-link" to="/login">Back to sign in</Link>
      </form>
    </section></main>
  );
}

export function PermanentCloseAccountPage() {
  const [params] = useSearchParams();
  const initialRole = roleFromQuery(params.get('role'));
  const [role, setRole] = useState<LifecycleRole>(initialRole ?? 'DOCTOR');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [complete, setComplete] = useState(false);
  const [error, setError] = useState('');
  const warning = useMemo(() => role === 'DOCTOR'
    ? 'Your Doctor account cannot be reactivated. Your public Doctor profile and booking route are permanently retired. A started clinic day must be resolved before closure can succeed.'
    : 'Your Secretary account cannot be reactivated. Current assignments and exceptional capabilities are removed and are not restored.', [role]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!confirmed) return;
    setSubmitting(true);
    setError('');
    try {
      await apiRequest(`${lifecycleBase(role)}/permanent-delete`, {
        method: 'POST',
        headers: { 'Idempotency-Key': idempotencyKey('permanent-close-account') },
        body: { email, password, confirmPermanentDelete: true },
      });
      setComplete(true);
    } catch (caught) {
      setError(permanentClosureErrorMessage(caught));
    } finally {
      setSubmitting(false);
    }
  }

  if (complete) {
    return (
      <main className="auth-page"><section className="auth-panel">
        <Link className="brand" to="/">Clinic Queueing</Link>
        <div className="auth-heading"><p className="eyebrow">Permanent closure complete</p><h1>Account permanently closed.</h1><p>This account identity cannot be reactivated. Any remaining historical records are retained only under the approved audit, financial, and privacy rules.</p></div>
        <Link className="secondary-action" to="/">Return home</Link>
      </section></main>
    );
  }

  return (
    <main className="auth-page"><section className="auth-panel wide-auth-panel" aria-labelledby="close-heading">
      <Link className="brand" to="/">Clinic Queueing</Link>
      <div className="auth-heading"><p className="eyebrow">Permanent account closure</p><h1 id="close-heading">This cannot be undone.</h1><p>{warning}</p></div>
      <form className="stack" onSubmit={submit}>
        <label>Account type<select value={role} onChange={(event) => setRole(event.target.value as LifecycleRole)}><option value="DOCTOR">Doctor</option><option value="SECRETARY">Secretary</option></select></label>
        <label>Email<input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></label>
        <label>Password<input type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} /></label>
        <label className="confirmation-check"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /><span>I understand this permanently closes this account and cannot be reversed.</span></label>
        {error ? <div className="form-error" role="alert">{error}</div> : null}
        <button className="primary danger-primary" type="submit" disabled={submitting || !email || !password || !confirmed}>{submitting ? 'Closing account…' : 'Permanently close account'}</button>
        <Link className="secondary-action" to="/login">Cancel</Link>
      </form>
    </section></main>
  );
}
