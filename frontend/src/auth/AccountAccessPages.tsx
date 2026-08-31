import { FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ApiError, apiRequest } from '../api/client';

function messageFor(error: unknown, fallback: string) {
  return error instanceof ApiError ? error.message : fallback;
}

function AccountFrame({ children }: { children: React.ReactNode }) {
  return (
    <main className="auth-page">
      <section className="auth-panel">
        <Link className="brand" to="/">
          Clinic Queueing
        </Link>
        {children}
      </section>
    </main>
  );
}

export function AccountRegistrationEntryPage() {
  return (
    <AccountFrame>
      <div className="auth-heading account-type-heading">
        <p className="eyebrow">Create account</p>
        <h1>Choose your account type</h1>
        <p>Choose the role you will use in Clinic Queueing.</p>
      </div>
      <div className="account-type-options" aria-label="Account type">
        <Link className="account-type-option" to="/register/doctor">
          <span className="account-type-icon" aria-hidden="true">
            +
          </span>
          <span>
            <strong>Doctor</strong>
            <small>
              Create and verify a Doctor account for managing clinics.
            </small>
          </span>
          <b aria-hidden="true">›</b>
        </Link>
        <Link className="account-type-option" to="/register/secretary">
          <span className="account-type-icon" aria-hidden="true">
            S
          </span>
          <span>
            <strong>Secretary</strong>
            <small>
              Create a basic account. Clinic access appears after a Doctor
              assigns you.
            </small>
          </span>
          <b aria-hidden="true">›</b>
        </Link>
      </div>
      <Link
        className="quiet-link auth-center-link auth-spaced-link"
        to="/login"
      >
        Back to sign in
      </Link>
    </AccountFrame>
  );
}

export function SecretaryRegistrationPage() {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [firstName, setFirstName] = useState('');
  const [middleName, setMiddleName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [mobileNumber, setMobileNumber] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    if (!password.trim()) {
      setError('Password must not be blank.');
      return;
    }
    setBusy(true);
    try {
      await apiRequest('/secretary/register', {
        method: 'POST',
        body: {
          firstName,
          middleName: middleName || undefined,
          lastName,
          email,
          mobileNumber,
          password,
        },
      });
      navigate(`/verify-email?email=${encodeURIComponent(email.trim())}`, {
        replace: true,
        state: { registrationComplete: true },
      });
    } catch (caught) {
      setError(
        messageFor(
          caught,
          'Unable to create the account right now. Please try again.',
        ),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <AccountFrame>
      <div className="auth-heading">
        <p className="eyebrow">Secretary account</p>
        <h1>Create your account</h1>
        <p>
          Your dashboard starts without clinics. Doctors can later assign this
          account to one or more clinics.
        </p>
      </div>
      <form className="stack auth-long-form" onSubmit={submit}>
        <div className="auth-field-grid">
          <label>
            First name
            <input
              required
              maxLength={100}
              autoComplete="given-name"
              value={firstName}
              onChange={(event) => setFirstName(event.target.value)}
            />
          </label>
          <label>
            Middle name <span className="optional">Optional</span>
            <input
              maxLength={100}
              autoComplete="additional-name"
              value={middleName}
              onChange={(event) => setMiddleName(event.target.value)}
            />
          </label>
        </div>
        <label>
          Last name
          <input
            required
            maxLength={100}
            autoComplete="family-name"
            value={lastName}
            onChange={(event) => setLastName(event.target.value)}
          />
        </label>
        <label>
          Email
          <input
            type="email"
            required
            maxLength={255}
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>
        <label>
          Mobile number
          <input
            type="tel"
            required
            maxLength={30}
            autoComplete="tel"
            placeholder="09… or +63…"
            value={mobileNumber}
            onChange={(event) => setMobileNumber(event.target.value)}
          />
        </label>
        <label>
          Password
          <input
            type="password"
            required
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        <label>
          Confirm password
          <input
            type="password"
            required
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
          />
        </label>
        {error ? (
          <div className="form-error" role="alert">
            {error}
          </div>
        ) : null}
        <button className="primary" type="submit" disabled={busy}>
          {busy ? 'Creating account…' : 'Create secretary account'}
        </button>
        <p className="auth-footnote">
          Already have an account? <Link to="/login">Sign in</Link>
        </p>
      </form>
    </AccountFrame>
  );
}

export function DoctorRegistrationPage() {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [firstName, setFirstName] = useState('');
  const [middleName, setMiddleName] = useState('');
  const [lastName, setLastName] = useState('');
  const [suffix, setSuffix] = useState('');
  const [email, setEmail] = useState('');
  const [mobileNumber, setMobileNumber] = useState('');
  const [professionalTitle, setProfessionalTitle] = useState('');
  const [specialization, setSpecialization] = useState('');
  const [licenseNumber, setLicenseNumber] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    if (!password.trim()) {
      setError('Password must not be blank.');
      return;
    }
    setBusy(true);
    try {
      await apiRequest('/doctor/register', {
        method: 'POST',
        body: {
          firstName,
          middleName: middleName || undefined,
          lastName,
          suffix: suffix || undefined,
          email,
          mobileNumber,
          password,
          professionalTitle,
          specialization,
          licenseNumber,
        },
      });
      navigate(`/verify-email?email=${encodeURIComponent(email.trim())}`, {
        replace: true,
        state: { registrationComplete: true },
      });
    } catch (caught) {
      setError(
        messageFor(
          caught,
          'Unable to create the account right now. Please try again.',
        ),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <AccountFrame>
      <div className="auth-heading">
        <p className="eyebrow">Doctor account</p>
        <h1>Create your account</h1>
        <p>
          Your email becomes your sign-in address. Email verification is
          required before staff access.
        </p>
      </div>
      <form className="stack auth-long-form" onSubmit={submit}>
        <div className="auth-field-grid">
          <label>
            First name
            <input
              required
              maxLength={100}
              autoComplete="given-name"
              value={firstName}
              onChange={(event) => setFirstName(event.target.value)}
            />
          </label>
          <label>
            Middle name <span className="optional">Optional</span>
            <input
              maxLength={100}
              autoComplete="additional-name"
              value={middleName}
              onChange={(event) => setMiddleName(event.target.value)}
            />
          </label>
          <label>
            Last name
            <input
              required
              maxLength={100}
              autoComplete="family-name"
              value={lastName}
              onChange={(event) => setLastName(event.target.value)}
            />
          </label>
          <label>
            Suffix <span className="optional">Optional</span>
            <input
              maxLength={30}
              value={suffix}
              onChange={(event) => setSuffix(event.target.value)}
            />
          </label>
        </div>
        <label>
          Email
          <input
            type="email"
            required
            maxLength={255}
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>
        <label>
          Mobile number
          <input
            type="tel"
            required
            maxLength={30}
            autoComplete="tel"
            placeholder="09… or +63…"
            value={mobileNumber}
            onChange={(event) => setMobileNumber(event.target.value)}
          />
        </label>
        <div className="auth-field-grid">
          <label>
            Professional title
            <input
              required
              maxLength={50}
              placeholder="e.g. Dr."
              value={professionalTitle}
              onChange={(event) => setProfessionalTitle(event.target.value)}
            />
          </label>
          <label>
            Specialization
            <input
              required
              maxLength={150}
              placeholder="e.g. Family Medicine"
              value={specialization}
              onChange={(event) => setSpecialization(event.target.value)}
            />
          </label>
        </div>
        <label>
          Professional license number
          <input
            required
            maxLength={100}
            value={licenseNumber}
            onChange={(event) => setLicenseNumber(event.target.value)}
          />
        </label>
        <label>
          Password
          <input
            type="password"
            required
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        <label>
          Confirm password
          <input
            type="password"
            required
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
          />
        </label>
        {error ? (
          <div className="form-error" role="alert">
            {error}
          </div>
        ) : null}
        <button className="primary" type="submit" disabled={busy}>
          {busy ? 'Creating account…' : 'Create doctor account'}
        </button>
        <p className="auth-footnote">
          Already have an account? <Link to="/login">Sign in</Link>
        </p>
      </form>
    </AccountFrame>
  );
}

export function VerifyEmailPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token')?.trim() ?? '';
  const initialEmail = searchParams.get('email')?.trim() ?? '';
  const [email, setEmail] = useState(initialEmail);
  const [state, setState] = useState<
    'idle' | 'verifying' | 'verified' | 'error'
  >(token ? 'verifying' : 'idle');
  const [message, setMessage] = useState(
    token
      ? 'Verifying your email…'
      : 'Open the verification link sent to your email address.',
  );
  const [resending, setResending] = useState(false);

  useEffect(() => {
    if (!token) return;
    let active = true;
    void apiRequest('/auth/verify-email', { method: 'POST', body: { token } })
      .then(() => {
        if (!active) return;
        setState('verified');
        setMessage('Your email is verified. You can now sign in.');
      })
      .catch((caught) => {
        if (!active) return;
        setState('error');
        setMessage(
          messageFor(
            caught,
            'This verification link is invalid or no longer available.',
          ),
        );
      });
    return () => {
      active = false;
    };
  }, [token]);

  async function resend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!email.trim() || resending) return;
    setResending(true);
    try {
      await apiRequest('/auth/resend-email-verification', {
        method: 'POST',
        body: { email: email.trim() },
      });
      setMessage(
        'If this account is eligible for verification, a new verification email has been sent.',
      );
      setState('idle');
    } catch (caught) {
      setMessage(
        messageFor(
          caught,
          'Unable to request another verification email right now.',
        ),
      );
      setState('error');
    } finally {
      setResending(false);
    }
  }

  return (
    <AccountFrame>
      <div className="auth-heading">
        <p className="eyebrow">Email verification</p>
        <h1>{state === 'verified' ? 'Email verified' : 'Verify your email'}</h1>
        <p role="status">{message}</p>
      </div>
      {state === 'verified' ? (
        <Link className="primary-action auth-full-action" to="/login">
          Continue to sign in
        </Link>
      ) : null}
      {state !== 'verified' && state !== 'verifying' ? (
        <form className="stack" onSubmit={resend}>
          <label>
            Email
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          <button
            className="secondary"
            type="submit"
            disabled={resending || !email.trim()}
          >
            {resending ? 'Sending…' : 'Send a new verification email'}
          </button>
          <Link className="quiet-link auth-center-link" to="/login">
            Back to sign in
          </Link>
        </form>
      ) : null}
    </AccountFrame>
  );
}

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!email.trim() || busy) return;
    setBusy(true);
    setError('');
    try {
      await apiRequest('/auth/request-password-reset', {
        method: 'POST',
        body: { email: email.trim() },
      });
      setSubmitted(true);
    } catch (caught) {
      setError(
        messageFor(caught, 'Unable to request a password reset right now.'),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <AccountFrame>
      <div className="auth-heading">
        <p className="eyebrow">Password recovery</p>
        <h1>Reset your password</h1>
        <p>
          {submitted
            ? 'If an eligible account uses that email, a password-reset link has been sent.'
            : 'Enter your sign-in email. For security, this page will not confirm whether an account exists.'}
        </p>
      </div>
      {!submitted ? (
        <form className="stack" onSubmit={submit}>
          <label>
            Email
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          {error ? (
            <div className="form-error" role="alert">
              {error}
            </div>
          ) : null}
          <button
            className="primary"
            type="submit"
            disabled={busy || !email.trim()}
          >
            {busy ? 'Sending…' : 'Send reset link'}
          </button>
        </form>
      ) : null}
      <Link
        className="quiet-link auth-center-link auth-spaced-link"
        to="/login"
      >
        Back to sign in
      </Link>
    </AccountFrame>
  );
}

export function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token')?.trim() ?? '';
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [complete, setComplete] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    if (!token) {
      setError('This password-reset link is invalid or incomplete.');
      return;
    }
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
      await apiRequest('/auth/reset-password', {
        method: 'POST',
        body: { token, newPassword: password },
      });
      setComplete(true);
    } catch (caught) {
      setError(
        messageFor(
          caught,
          'This password-reset link is invalid or no longer available.',
        ),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <AccountFrame>
      <div className="auth-heading">
        <p className="eyebrow">Password recovery</p>
        <h1>{complete ? 'Password changed' : 'Choose a new password'}</h1>
        <p>
          {complete
            ? 'Your existing staff sessions have been revoked. Sign in again with the new password.'
            : 'A successful reset replaces the password and signs the account out of existing sessions.'}
        </p>
      </div>
      {complete ? (
        <Link className="primary-action auth-full-action" to="/login">
          Sign in again
        </Link>
      ) : (
        <form className="stack" onSubmit={submit}>
          <label>
            New password
            <input
              type="password"
              required
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          <label>
            Confirm new password
            <input
              type="password"
              required
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
            />
          </label>
          {error ? (
            <div className="form-error" role="alert">
              {error}
            </div>
          ) : null}
          <button className="primary" type="submit" disabled={busy}>
            {busy ? 'Changing password…' : 'Change password'}
          </button>
        </form>
      )}
    </AccountFrame>
  );
}
