import { FormEvent, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ApiError, apiRequest } from '../api/client';
import clinicWaitingRoom from '../assets/clinic-waiting-room.jpg';
import { useAuth } from './AuthContext';

type VerificationResult = { verified: true; role: 'DOCTOR' | 'SECRETARY' };
type VerificationIconName = 'brand' | 'check' | 'lock' | 'phone' | 'shield';

function VerificationIcon({ name }: { name: VerificationIconName }) {
  const paths: Record<VerificationIconName, React.ReactNode> = {
    brand: <path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6z" />,
    check: <path d="m5 12 4 4L19 6" />,
    lock: <><rect x="5" y="10" width="14" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3" /></>,
    phone: <><rect x="7" y="2" width="10" height="20" rx="2" /><path d="M10 5h4M11 18h2" /></>,
    shield: <><path d="M12 2 4 5v6c0 5.4 3.4 9.3 8 11 4.6-1.7 8-5.6 8-11V5z" /><path d="m8.5 12 2.2 2.2 4.8-5" /></>,
  };
  return <svg className="sign-in-icon" viewBox="0 0 24 24" aria-hidden="true">{paths[name]}</svg>;
}

function VerificationFrame({ children }: { children: React.ReactNode }) {
  return (
    <main className="sign-in-page password-recovery-page">
      <section className="sign-in-brand-panel" aria-label="Clinic Queueing introduction">
        <div className="sign-in-brand-content">
          <Link className="sign-in-brand" to="/" aria-label="Clinic Queueing home">
            <span><VerificationIcon name="brand" /></span>
            <strong>CLINIC QUEUEING<small>SaaS</small></strong>
          </Link>
          <div className="recovery-pitch">
            <h1>Secure<br />account<br />verification.</h1>
            <p>One final step keeps your account protected before access begins.</p>
            <ul>
              <li><span><VerificationIcon name="phone" /></span><div><strong>Mobile verification</strong><p>Confirm the mobile number registered to this account.</p></div></li>
              <li><span><VerificationIcon name="shield" /></span><div><strong>Protected activation</strong><p>Your account becomes usable only after successful verification.</p></div></li>
            </ul>
          </div>
          <img className="clinic-illustration" src={clinicWaitingRoom} alt="" aria-hidden="true" decoding="async" />
        </div>
      </section>
      <section className="sign-in-auth-panel">
        <div className="sign-in-auth-content">
          <div className="recovery-center">{children}</div>
        </div>
      </section>
      <footer className="sign-in-footer">
        <div>
          <p><VerificationIcon name="lock" /> Secure <span>•</span> Private <span>•</span> Compliant</p>
          <p>© 2026 Clinic Queueing SaaS. All rights reserved.</p>
        </div>
      </footer>
    </main>
  );
}

export function MobileVerificationPage() {
  const { refresh } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const userId = searchParams.get('userId')?.trim() ?? '';
  const [otp, setOtp] = useState('');
  const [busy, setBusy] = useState(false);
  const [resending, setResending] = useState(false);
  const [message, setMessage] = useState(
    'Enter the 6-digit verification code sent to your mobile number.',
  );
  const [error, setError] = useState('');

  async function verify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!userId || otp.length !== 6 || busy) return;
    setBusy(true);
    setError('');
    try {
      const result = await apiRequest<VerificationResult>('/auth/verify-mobile', {
        method: 'POST',
        body: { userId, otp },
      });
      await refresh();
      navigate(`/registration/account-ready?role=${result.role}`, { replace: true });
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : 'Unable to verify this code right now.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    if (!userId || resending) return;
    setResending(true);
    setError('');
    try {
      await apiRequest('/auth/resend-mobile-verification', {
        method: 'POST',
        body: { userId },
      });
      setMessage('A new verification code has been requested.');
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : 'Unable to request another code right now.',
      );
    } finally {
      setResending(false);
    }
  }

  return (
    <VerificationFrame>
      <section className="recovery-card" aria-labelledby="mobile-verification-heading">
        <header>
          <p className="eyebrow">Mobile verification</p>
          <h2 id="mobile-verification-heading">Verify your mobile number</h2>
          <p role="status">{message}</p>
        </header>
        {userId ? (
          <form onSubmit={verify} noValidate>
            <label htmlFor="mobile-verification-code">Verification code</label>
            <div className="sign-in-input">
              <VerificationIcon name="phone" />
              <input
                id="mobile-verification-code"
                required
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                pattern="[0-9]{6}"
                placeholder="Enter 6-digit code"
                value={otp}
                onChange={(event) =>
                  setOtp(event.target.value.replace(/\D/g, '').slice(0, 6))
                }
              />
            </div>
            {error ? <div className="form-error" role="alert">{error}</div> : null}
            <button className="sign-in-submit" type="submit" disabled={busy || otp.length !== 6}>
              {busy ? 'Verifying…' : 'Verify mobile number'}
            </button>
            <button className="recovery-secondary" type="button" disabled={resending} onClick={() => void resend()}>
              {resending ? 'Sending…' : 'Send a new code'}
            </button>
            <Link className="recovery-back-link" to="/login">Back to sign in</Link>
          </form>
        ) : (
          <div className="form-error" role="alert">
            This verification request is incomplete. Create the account again.
          </div>
        )}
      </section>
    </VerificationFrame>
  );
}
