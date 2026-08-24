import { FormEvent, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ApiError, apiRequest } from '../api/client';

type Feedback = { kind: 'success' | 'error'; message: string } | null;

function messageFor(error: unknown, fallback: string) {
  return error instanceof ApiError ? error.message : fallback;
}

function AccessFrame({ eyebrow, title, copy, children }: { eyebrow: string; title: string; copy: string; children: React.ReactNode }) {
  return (
    <main className="auth-page">
      <section className="auth-panel" aria-labelledby="account-access-heading">
        <Link className="brand" to="/">Clinic Queueing</Link>
        <div className="auth-heading">
          <p className="eyebrow">{eyebrow}</p>
          <h1 id="account-access-heading">{title}</h1>
          <p>{copy}</p>
        </div>
        {children}
      </section>
    </main>
  );
}

function FeedbackMessage({ feedback }: { feedback: Feedback }) {
  if (!feedback) return null;
  return <div className={feedback.kind === 'error' ? 'form-error' : 'form-success'} role={feedback.kind === 'error' ? 'alert' : 'status'}>{feedback.message}</div>;
}

export function DoctorRegistrationPage() {
  const [form, setForm] = useState({ firstName: '', middleName: '', lastName: '', suffix: '', email: '', mobileNumber: '', password: '', professionalTitle: 'Dr.', specialization: '', licenseNumber: '' });
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();

  function set(field: keyof typeof form, value: string) { setForm((current) => ({ ...current, [field]: value })); }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFeedback(null);
    setSubmitting(true);
    try {
      await apiRequest('/doctor/register', {
        method: 'POST',
        body: {
          ...form,
          middleName: form.middleName || undefined,
          suffix: form.suffix || undefined,
        },
      });
      navigate(`/verify-email?email=${encodeURIComponent(form.email)}`, { replace: true });
    } catch (error) {
      setFeedback({ kind: 'error', message: messageFor(error, 'Unable to create your Doctor account. Please try again.') });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AccessFrame eyebrow="Doctor account" title="Create your account" copy="Use your professional details. Your email must be verified before ordinary Doctor access is available.">
      <form className="stack" onSubmit={submit}>
        <div className="field-row">
          <label>First name<input required maxLength={100} autoComplete="given-name" value={form.firstName} onChange={(e) => set('firstName', e.target.value)} /></label>
          <label>Last name<input required maxLength={100} autoComplete="family-name" value={form.lastName} onChange={(e) => set('lastName', e.target.value)} /></label>
        </div>
        <div className="field-row">
          <label>Middle name <span className="optional">Optional</span><input maxLength={100} value={form.middleName} onChange={(e) => set('middleName', e.target.value)} /></label>
          <label>Suffix <span className="optional">Optional</span><input maxLength={30} value={form.suffix} onChange={(e) => set('suffix', e.target.value)} /></label>
        </div>
        <label>Email<input required type="email" autoComplete="email" value={form.email} onChange={(e) => set('email', e.target.value)} /></label>
        <label>Mobile number<input required inputMode="tel" autoComplete="tel" maxLength={30} value={form.mobileNumber} onChange={(e) => set('mobileNumber', e.target.value)} /></label>
        <label>Password<input required type="password" autoComplete="new-password" value={form.password} onChange={(e) => set('password', e.target.value)} /></label>
        <div className="field-row">
          <label>Professional title<input required maxLength={50} value={form.professionalTitle} onChange={(e) => set('professionalTitle', e.target.value)} /></label>
          <label>Specialization<input required maxLength={150} value={form.specialization} onChange={(e) => set('specialization', e.target.value)} /></label>
        </div>
        <label>Professional license number<input required maxLength={100} value={form.licenseNumber} onChange={(e) => set('licenseNumber', e.target.value)} /></label>
        <FeedbackMessage feedback={feedback} />
        <button className="primary" disabled={submitting} type="submit">{submitting ? 'Creating account…' : 'Create Doctor account'}</button>
        <p className="form-note">Already registered? <Link to="/login">Sign in</Link></p>
      </form>
    </AccessFrame>
  );
}

export function VerifyEmailPage() {
  const [params] = useSearchParams();
  const initialEmail = params.get('email') ?? '';
  const token = params.get('token') ?? '';
  const [email, setEmail] = useState(initialEmail);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [submitting, setSubmitting] = useState(false);

  async function verify() {
    if (!token) return;
    setSubmitting(true); setFeedback(null);
    try {
      await apiRequest('/auth/verify-email', { method: 'POST', body: { token } });
      setFeedback({ kind: 'success', message: 'Email verified. You can now sign in.' });
    } catch (error) {
      setFeedback({ kind: 'error', message: messageFor(error, 'This verification link could not be used.') });
    } finally { setSubmitting(false); }
  }

  async function resend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSubmitting(true); setFeedback(null);
    try {
      await apiRequest('/auth/resend-email-verification', { method: 'POST', body: { email } });
      setFeedback({ kind: 'success', message: 'If the account is eligible, a new verification message has been prepared.' });
    } catch (error) {
      setFeedback({ kind: 'error', message: messageFor(error, 'Unable to request a new verification message.') });
    } finally { setSubmitting(false); }
  }

  return (
    <AccessFrame eyebrow="Email verification" title={token ? 'Verify your email' : 'Check your email'} copy={token ? 'Confirm this email address to complete Doctor account verification.' : 'Use the verification link sent to your registered email address.'}>
      <div className="stack">
        {token ? <button className="primary" type="button" disabled={submitting} onClick={verify}>{submitting ? 'Verifying…' : 'Verify email'}</button> : null}
        <FeedbackMessage feedback={feedback} />
        <form className="stack compact-stack" onSubmit={resend}>
          <label>Email<input required type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
          <button className="secondary" type="submit" disabled={submitting || !email}>Send verification again</button>
        </form>
        <Link className="quiet-link" to="/login">Return to sign in</Link>
      </div>
    </AccessFrame>
  );
}

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [submitting, setSubmitting] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSubmitting(true); setFeedback(null);
    try {
      await apiRequest('/auth/request-password-reset', { method: 'POST', body: { email } });
      setFeedback({ kind: 'success', message: 'If the account is eligible, password-reset instructions have been prepared.' });
    } catch (error) {
      setFeedback({ kind: 'error', message: messageFor(error, 'Unable to request a password reset.') });
    } finally { setSubmitting(false); }
  }
  return (
    <AccessFrame eyebrow="Account access" title="Reset your password" copy="Enter the email used for your staff account. The response stays deliberately neutral for account privacy.">
      <form className="stack" onSubmit={submit}>
        <label>Email<input required type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
        <FeedbackMessage feedback={feedback} />
        <button className="primary" disabled={submitting || !email}>{submitting ? 'Sending…' : 'Continue'}</button>
        <Link className="quiet-link" to="/login">Return to sign in</Link>
      </form>
    </AccessFrame>
  );
}

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [submitting, setSubmitting] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setFeedback(null);
    if (!token) { setFeedback({ kind: 'error', message: 'This password-reset link is incomplete.' }); return; }
    if (password !== confirmation) { setFeedback({ kind: 'error', message: 'The passwords do not match.' }); return; }
    setSubmitting(true);
    try {
      await apiRequest('/auth/reset-password', { method: 'POST', body: { token, newPassword: password } });
      setFeedback({ kind: 'success', message: 'Password changed. Existing sessions protected by the reset lifecycle are no longer relied on for access.' });
    } catch (error) {
      setFeedback({ kind: 'error', message: messageFor(error, 'Unable to reset the password.') });
    } finally { setSubmitting(false); }
  }
  return (
    <AccessFrame eyebrow="Account access" title="Choose a new password" copy="Use the secure reset link from your email. A completed password replacement follows the backend session-revocation rules.">
      <form className="stack" onSubmit={submit}>
        <label>New password<input required type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
        <label>Confirm new password<input required type="password" autoComplete="new-password" value={confirmation} onChange={(e) => setConfirmation(e.target.value)} /></label>
        <FeedbackMessage feedback={feedback} />
        <button className="primary" disabled={submitting || !password || !confirmation}>{submitting ? 'Changing password…' : 'Change password'}</button>
        <Link className="quiet-link" to="/login">Return to sign in</Link>
      </form>
    </AccessFrame>
  );
}

export function DoctorReactivationPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [submitting, setSubmitting] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSubmitting(true); setFeedback(null);
    try {
      await apiRequest('/doctor/account/reactivate', {
        method: 'POST',
        headers: { 'Idempotency-Key': crypto.randomUUID() },
        body: { email, password },
      });
      setFeedback({ kind: 'success', message: 'Account reactivated. Sign in again to establish a new session.' });
    } catch (error) {
      setFeedback({ kind: 'error', message: messageFor(error, 'Unable to reactivate this account.') });
    } finally { setSubmitting(false); }
  }
  return (
    <AccessFrame eyebrow="Doctor account" title="Reactivate your account" copy="This is only for a Doctor account that was reversibly disabled. Permanent closure cannot be undone.">
      <form className="stack" onSubmit={submit}>
        <label>Email<input required type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
        <label>Password<input required type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
        <FeedbackMessage feedback={feedback} />
        <button className="primary" disabled={submitting || !email || !password}>{submitting ? 'Reactivating…' : 'Reactivate account'}</button>
        <Link className="quiet-link" to="/login">Return to sign in</Link>
      </form>
    </AccessFrame>
  );
}
