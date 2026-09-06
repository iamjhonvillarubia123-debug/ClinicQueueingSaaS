import { FormEvent, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ApiError, apiRequest } from '../api/client';
import { useAuth } from './AuthContext';

type VerificationResult = { verified: true; role: 'DOCTOR' | 'SECRETARY' };

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
      navigate(`/registration/account-ready?role=${result.role}`, {
        replace: true,
      });
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
    <main className="auth-page">
      <section className="auth-panel">
        <Link className="brand" to="/">Clinic Queueing</Link>
        <div className="auth-heading">
          <p className="eyebrow">Mobile verification</p>
          <h1>Verify your mobile number</h1>
          <p role="status">{message}</p>
        </div>
        {userId ? (
          <form className="stack" onSubmit={verify}>
            <label>
              Verification code
              <input
                required
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                pattern="[0-9]{6}"
                placeholder="6-digit code"
                value={otp}
                onChange={(event) =>
                  setOtp(event.target.value.replace(/\D/g, '').slice(0, 6))
                }
              />
            </label>
            {error ? <div className="form-error" role="alert">{error}</div> : null}
            <button className="primary" type="submit" disabled={busy || otp.length !== 6}>
              {busy ? 'Verifying…' : 'Verify mobile number'}
            </button>
            <button className="secondary" type="button" disabled={resending} onClick={() => void resend()}>
              {resending ? 'Sending…' : 'Send a new code'}
            </button>
            <Link className="quiet-link auth-center-link" to="/login">Back to sign in</Link>
          </form>
        ) : (
          <div className="form-error" role="alert">
            This verification request is incomplete. Create the account again.
          </div>
        )}
      </section>
    </main>
  );
}
