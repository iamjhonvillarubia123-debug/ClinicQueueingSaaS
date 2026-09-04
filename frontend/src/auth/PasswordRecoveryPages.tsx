import { FormEvent, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { apiRequest } from '../api/client';
import clinicWaitingRoom from '../assets/clinic-waiting-room.jpg';
import { meetsPasswordPolicy, passwordChecks } from './passwordPolicy';

type IconName = 'brand' | 'check' | 'eye' | 'eyeOff' | 'lock' | 'mail';

function Icon({ name }: { name: IconName }) {
  const paths: Record<IconName, React.ReactNode> = {
    brand: <path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6z" />,
    check: <path d="m5 12 4 4L19 6" />,
    eye: <><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z" /><circle cx="12" cy="12" r="2.5" /></>,
    eyeOff: <><path d="m3 3 18 18M10.6 6.2A10.7 10.7 0 0 1 12 6c6.5 0 10 6 10 6a18 18 0 0 1-2.1 2.8M6.6 6.6C3.6 8.3 2 12 2 12s3.5 6 10 6c1.1 0 2.1-.2 3-.5M9.9 9.9a3 3 0 0 0 4.2 4.2" /></>,
    lock: <><rect x="5" y="10" width="14" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3" /></>,
    mail: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m4 7 8 6 8-6" /></>,
  };
  return <svg className="sign-in-icon" viewBox="0 0 24 24" aria-hidden="true">{paths[name]}</svg>;
}

function RecoveryFrame({ children }: { children: React.ReactNode }) {
  return <main className="sign-in-page password-recovery-page">
    <section className="sign-in-brand-panel" aria-label="Clinic Queueing introduction">
      <div className="sign-in-brand-content">
        <Link className="sign-in-brand" to="/" aria-label="Clinic Queueing home"><span><Icon name="brand" /></span><strong>CLINIC QUEUEING<small>SaaS</small></strong></Link>
        <div className="recovery-pitch"><h1>Smart<br />queueing.<br />Better<br />patient care.</h1><p>A queue management<br />system built for clinics<br />to run efficiently and<br />serve patients better.</p></div>
        <img className="clinic-illustration" src={clinicWaitingRoom} alt="" aria-hidden="true" decoding="async" />
      </div>
    </section>
    <section className="sign-in-auth-panel"><div className="sign-in-auth-content"><div className="recovery-center">{children}</div></div></section>
    <footer className="sign-in-footer"><div><p><Icon name="lock" /> Secure <span>•</span> Private <span>•</span> Compliant</p><p>© 2026 Clinic Queueing SaaS. All rights reserved.</p></div></footer>
  </main>;
}

function messageFor(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [submittedEmail, setSubmittedEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function requestReset(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    const normalizedEmail = email.trim();
    if (!normalizedEmail || busy) return;
    setBusy(true);
    setError('');
    try {
      await apiRequest('/auth/request-password-reset', { method: 'POST', body: { email: normalizedEmail } });
      setSubmittedEmail(normalizedEmail);
    } catch (caught) {
      setError(messageFor(caught, 'Unable to request a password reset right now.'));
    } finally {
      setBusy(false);
    }
  }

  return <RecoveryFrame>{submittedEmail ? <section className="recovery-card recovery-email-card" aria-labelledby="check-email-heading">
    <div className="recovery-success-symbol"><Icon name="mail" /><span><Icon name="check" /></span></div>
    <header><h2 id="check-email-heading">Check your email</h2><p>We’ve sent a password reset link to</p><strong>{submittedEmail}</strong><p>The link will expire in 30 minutes<br />for security reasons.</p></header>
    <aside><strong>Didn’t receive the email?</strong><p>Check your spam or junk folder.<br />If you still don’t see it, you can<br />request a new link.</p></aside>
    {error ? <div className="form-error" role="alert">{error}</div> : null}
    <button className="recovery-secondary" type="button" disabled={busy} onClick={() => void requestReset()}>{busy ? 'Sending…' : 'Resend reset link'}</button>
    <Link className="recovery-back-link" to="/login">Back to sign in</Link>
  </section> : <section className="recovery-card" aria-labelledby="forgot-password-heading">
    <header><h2 id="forgot-password-heading">Forgot password?</h2><p>No problem. Enter your email<br />and we’ll send you a link to<br />reset your password.</p></header>
    <form onSubmit={requestReset} noValidate>
      <label htmlFor="recovery-email">Email address</label>
      <div className="sign-in-input"><Icon name="mail" /><input id="recovery-email" type="email" required autoComplete="email" placeholder="Enter your email address" value={email} onChange={(event) => setEmail(event.target.value)} /></div>
      {error ? <div className="form-error" role="alert">{error}</div> : null}
      <button className="sign-in-submit" type="submit" disabled={busy || !email.trim()}>{busy ? 'Sending…' : 'Send reset link'}</button>
      <Link className="recovery-back-link" to="/login">Back to sign in</Link>
    </form>
  </section>}</RecoveryFrame>;
}

export function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token')?.trim() ?? '';
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [busy, setBusy] = useState(false);
  const [complete, setComplete] = useState(false);
  const [error, setError] = useState('');
  const meetsRequirements = meetsPasswordPolicy(password);
  const passwordsMatch = password === confirmPassword && confirmPassword.length > 0;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    if (!token) return setError('This password-reset link is invalid or incomplete.');
    if (!meetsRequirements) return setError('Your new password does not meet all password requirements.');
    if (!passwordsMatch) return setError('Passwords do not match.');
    setBusy(true);
    try {
      await apiRequest('/auth/reset-password', { method: 'POST', body: { token, newPassword: password } });
      setComplete(true);
    } catch (caught) {
      setError(messageFor(caught, 'This password-reset link is invalid or no longer available.'));
    } finally {
      setBusy(false);
    }
  }

  if (complete) return <RecoveryFrame><section className="recovery-card recovery-complete-card" aria-labelledby="password-updated-heading">
    <div className="recovery-success-symbol recovery-lock-symbol"><Icon name="lock" /><span><Icon name="check" /></span></div>
    <header><h2 id="password-updated-heading">Password updated!</h2><p>Your password has been<br />successfully updated.</p></header>
    <Link className="recovery-primary-link" to="/login">Go to sign in</Link>
  </section></RecoveryFrame>;

  return <RecoveryFrame><section className="recovery-card recovery-reset-card" aria-labelledby="set-password-heading">
    <header><h2 id="set-password-heading">Set new password</h2><p>Please enter your new password<br />below.</p></header>
    <form onSubmit={submit} noValidate>
      <label htmlFor="new-password">New password</label>
      <div className="sign-in-input"><Icon name="lock" /><input id="new-password" type={showPassword ? 'text' : 'password'} autoComplete="new-password" placeholder="Enter new password" value={password} onChange={(event) => setPassword(event.target.value)} /><button type="button" className="password-visibility" aria-label={showPassword ? 'Hide new password' : 'Show new password'} onClick={() => setShowPassword((value) => !value)}><Icon name={showPassword ? 'eyeOff' : 'eye'} /></button></div>
      <div className="password-requirements"><strong>Password must contain:</strong><ul>{passwordChecks.map((check) => { const valid = check.valid(password); return <li className={valid ? 'valid' : ''} key={check.label}><span><Icon name="check" /></span>{check.label}</li>; })}</ul></div>
      <label htmlFor="confirm-new-password">Confirm new password</label>
      <div className="sign-in-input"><Icon name="lock" /><input id="confirm-new-password" type={showConfirmation ? 'text' : 'password'} autoComplete="new-password" placeholder="Re-enter new password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} /><button type="button" className="password-visibility" aria-label={showConfirmation ? 'Hide confirmed password' : 'Show confirmed password'} onClick={() => setShowConfirmation((value) => !value)}><Icon name={showConfirmation ? 'eyeOff' : 'eye'} /></button></div>
      {confirmPassword && !passwordsMatch ? <div className="form-error" role="alert">Passwords do not match.</div> : null}
      {error ? <div className="form-error" role="alert">{error}</div> : null}
      <button className="sign-in-submit" type="submit" disabled={busy || !token || !meetsRequirements || !passwordsMatch}>{busy ? 'Updating…' : 'Update password'}</button>
      <Link className="recovery-back-link" to="/login">Back to sign in</Link>
    </form>
  </section></RecoveryFrame>;
}