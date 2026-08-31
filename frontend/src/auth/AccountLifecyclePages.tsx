import { FormEvent, useMemo, useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { ApiError, apiRequest } from '../api/client';
import clinicWaitingRoom from '../assets/clinic-waiting-room.jpg';
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

type ReactivationIconName = 'brand' | 'check' | 'doctor' | 'eye' | 'eyeOff' | 'lock' | 'mail' | 'secretary' | 'shield';

function ReactivationIcon({ name }: { name: ReactivationIconName }) {
  const paths: Record<ReactivationIconName, React.ReactNode> = {
    brand: <path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6z" />,
    check: <path d="m5 12 4 4L19 6" />,
    doctor: <><circle cx="12" cy="7" r="4" /><path d="M5 21v-2a7 7 0 0 1 14 0v2M17 11v4M15 13h4" /></>,
    eye: <><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z" /><circle cx="12" cy="12" r="2.5" /></>,
    eyeOff: <><path d="m3 3 18 18M10.6 6.2A10.7 10.7 0 0 1 12 6c6.5 0 10 6 10 6a18 18 0 0 1-2.1 2.8M6.6 6.6C3.6 8.3 2 12 2 12s3.5 6 10 6c1.1 0 2.1-.2 3-.5M9.9 9.9a3 3 0 0 0 4.2 4.2" /></>,
    lock: <><rect x="5" y="10" width="14" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3" /></>,
    mail: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m4 7 8 6 8-6" /></>,
    secretary: <><circle cx="12" cy="7" r="4" /><path d="M5 21v-2a7 7 0 0 1 14 0v2" /></>,
    shield: <><path d="M12 2 4 5v6c0 5.4 3.4 9.3 8 11 4.6-1.7 8-5.6 8-11V5z" /><path d="m8.5 12 2.2 2.2 4.8-5" /></>,
  };
  return <svg className="sign-in-icon" viewBox="0 0 24 24" aria-hidden="true">{paths[name]}</svg>;
}

function ReactivationFrame({ children }: { children: React.ReactNode }) {
  return <main className="sign-in-page reactivation-page">
    <section className="sign-in-brand-panel" aria-label="Clinic Queueing introduction"><div className="sign-in-brand-content">
      <Link className="sign-in-brand" to="/" aria-label="Clinic Queueing home"><span><ReactivationIcon name="brand" /></span><strong>CLINIC QUEUEING<small>SaaS</small></strong></Link>
      <div className="reactivation-pitch"><h1>Welcome<br />back.</h1><p>Restore access to your Clinic Queueing account securely.</p><ul><li><ReactivationIcon name="shield" /><span><strong>Secure reactivation</strong>Only voluntarily disabled accounts can return.</span></li><li><ReactivationIcon name="lock" /><span><strong>Fresh sign-in required</strong>Reactivation never creates a session automatically.</span></li></ul></div>
      <img className="clinic-illustration" src={clinicWaitingRoom} alt="" aria-hidden="true" decoding="async" />
    </div></section>
    <section className="sign-in-auth-panel"><div className="sign-in-auth-content"><div className="reactivation-center">{children}</div></div></section>
    <footer className="sign-in-footer"><div><p><ReactivationIcon name="lock" /> Secure <span>•</span> Private <span>•</span> Compliant</p><p>© 2026 Clinic Queueing SaaS. All rights reserved.</p></div></footer>
  </main>;
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof ApiError ? error.message : fallback;
}

function permanentClosureError(error: unknown) {
  if (error instanceof ApiError && error.status === 401) {
    return 'Email or current password is incorrect.';
  }
  return errorMessage(error, 'Unable to permanently close the account.');
}

function reactivationError(error: unknown) {
  if (error instanceof ApiError && error.status === 401) {
    return 'The account type, email, or current password is incorrect.';
  }
  if (error instanceof ApiError && error.status === 409) {
    return 'This account cannot be reactivated from its current state.';
  }
  return errorMessage(error, 'Unable to reactivate the account right now.');
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
  const [role, setRole] = useState<LifecycleRole | ''>(initialRole ?? '');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [complete, setComplete] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!role || !email.trim() || !password || submitting) return;
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
      setError(reactivationError(caught));
    } finally {
      setSubmitting(false);
    }
  }

  if (complete) {
    return (
      <ReactivationFrame><section className="reactivation-card reactivation-complete" aria-labelledby="reactivated-heading">
        <div className="reactivation-success-icon"><ReactivationIcon name="shield" /><span><ReactivationIcon name="check" /></span></div>
        <header><p className="reactivation-step">Account restored</p><h1 id="reactivated-heading">Account reactivated.</h1><p>Your {role && friendlyRole(role)} account is active again.</p></header>
        {role === 'SECRETARY' ? <div className="reactivation-notice"><strong>Clinic access is not restored automatically</strong><p>A Doctor must assign you again before a clinic appears in your workspace.</p></div> : null}
        <p className="reactivation-session-note">Reactivation does not sign you in. Sign in to start a new secure session.</p>
        <Link className="reactivation-primary-link" to="/login">Go to sign in</Link>
      </section></ReactivationFrame>
    );
  }

  return (
    <ReactivationFrame><section className="reactivation-card" aria-labelledby="reactivate-heading">
      <header><p className="reactivation-step">Reactivate account</p><h1 id="reactivate-heading">Restore account access</h1><p>Enter the details of your voluntarily disabled account.</p></header>
      <form onSubmit={submit} noValidate>
        <fieldset className="reactivation-role-fieldset"><legend>Choose your account type</legend><div className="reactivation-role-options">
          <label className={role === 'DOCTOR' ? 'selected' : ''}><input type="radio" name="reactivation-role" value="DOCTOR" checked={role === 'DOCTOR'} onChange={() => setRole('DOCTOR')} /><span className="role-icon"><ReactivationIcon name="doctor" /></span><span><strong>Doctor</strong><small>Clinic owner or Doctor account</small></span><i aria-hidden="true"><ReactivationIcon name="check" /></i></label>
          <label className={role === 'SECRETARY' ? 'selected' : ''}><input type="radio" name="reactivation-role" value="SECRETARY" checked={role === 'SECRETARY'} onChange={() => setRole('SECRETARY')} /><span className="role-icon"><ReactivationIcon name="secretary" /></span><span><strong>Secretary</strong><small>Secretary account</small></span><i aria-hidden="true"><ReactivationIcon name="check" /></i></label>
        </div></fieldset>
        <label htmlFor="reactivation-email">Email address</label><div className="sign-in-input"><ReactivationIcon name="mail" /><input id="reactivation-email" type="email" autoComplete="email" required placeholder="Enter your email address" value={email} onChange={(event) => setEmail(event.target.value)} /></div>
        <label htmlFor="reactivation-password">Current password</label><div className="sign-in-input"><ReactivationIcon name="lock" /><input id="reactivation-password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" required placeholder="Enter your current password" value={password} onChange={(event) => setPassword(event.target.value)} /><button type="button" className="password-visibility" aria-label={showPassword ? 'Hide current password' : 'Show current password'} onClick={() => setShowPassword((visible) => !visible)}><ReactivationIcon name={showPassword ? 'eyeOff' : 'eye'} /></button></div>
        <div className="reactivation-guidance"><strong>Before you continue</strong><ul><li>Reactivation does not sign you in automatically.</li><li>{role === 'SECRETARY' ? 'Previous clinic assignments and authority will not be restored.' : 'Administratively restricted accounts cannot be restored here.'}</li><li>Permanently closed accounts cannot be reactivated.</li></ul></div>
        {error ? <div className="form-error" role="alert">{error}</div> : null}
        <button className="sign-in-submit" type="submit" disabled={submitting || !role || !email.trim() || !password}>{submitting ? 'Reactivating…' : 'Reactivate account'}</button>
        <Link className="reactivation-back-link" to="/login">Back to sign in</Link>
      </form>
    </section></ReactivationFrame>
  );
}

export function PermanentCloseAccountPage() {
  const { refresh } = useAuth();
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
      await refresh();
      setComplete(true);
    } catch (caught) {
      setError(permanentClosureError(caught));
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
