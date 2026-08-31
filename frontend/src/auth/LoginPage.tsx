import { FormEvent, useEffect, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { ApiError } from '../api/client';
import { useAuth } from './AuthContext';

function Icon({ name }: { name: 'brand' | 'calendar' | 'chart' | 'shield' | 'mail' | 'lock' | 'eye' | 'eyeOff' | 'globe' }) {
  const paths: Record<typeof name, React.ReactNode> = {
    brand: <><path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6z" /></>,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M7 3v4M17 3v4M3 10h18M8 14h2M14 14h2M8 18h2" /></>,
    chart: <><path d="M4 20V10M10 20V4M16 20v-7M22 20V7M2 20h22" /></>,
    shield: <><path d="M12 2 4 5v6c0 5.4 3.4 9.3 8 11 4.6-1.7 8-5.6 8-11V5zM12 7v10M8 11l4 4 4-4" /></>,
    mail: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m4 7 8 6 8-6" /></>,
    lock: <><rect x="5" y="10" width="14" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3" /></>,
    eye: <><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z" /><circle cx="12" cy="12" r="2.5" /></>,
    eyeOff: <><path d="m3 3 18 18M10.6 6.2A10.7 10.7 0 0 1 12 6c6.5 0 10 6 10 6a18 18 0 0 1-2.1 2.8M6.6 6.6C3.6 8.3 2 12 2 12s3.5 6 10 6c1.1 0 2.1-.2 3-.5M9.9 9.9a3 3 0 0 0 4.2 4.2" /></>,
    globe: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.5 2.5 3.5 5.5 3.5 9S14.5 18.5 12 21M12 3C9.5 5.5 8.5 8.5 8.5 12S9.5 18.5 12 21" /></>,
  };
  return <svg className="sign-in-icon" viewBox="0 0 24 24" aria-hidden="true">{paths[name]}</svg>;
}

function ClinicIllustration() {
  return <svg className="clinic-illustration" viewBox="0 0 680 330" aria-hidden="true">
    <g fill="none" stroke="currentColor" strokeWidth="1.55" strokeLinecap="round" strokeLinejoin="round">
      <path d="M285 279V58L602 15v264M602 15v264H666" />
      <circle cx="182" cy="81" r="23" /><path d="M182 62v20l11 8M182 58v4M205 81h-4M182 104v-4M159 81h4" />

      <path d="M43 277h42l-5 33H49zM64 277V139" />
      <path d="M64 176C39 159 34 135 43 124c21 5 30 22 21 52M65 158c9-30 28-47 43-44 3 22-11 43-43 62M64 211c-25-18-45-18-56-8 9 20 28 27 56 23M65 218c20-22 41-25 54-16-7 20-27 31-54 31M63 144c-13-23-10-43 1-51 16 11 19 28 0 51" />

      <path d="M100 267h157M107 267l-7-67M253 267l8-67M116 200h43c8 0 13 5 14 13l5 42h-69l-5-42c-1-8 4-13 12-13zM171 200h43c8 0 13 5 14 13l5 42h-55l-5-42c-1-8 4-13 12-13zM226 200h28c8 0 13 5 14 13l5 32c1 7-3 10-10 10h-30l-5-42c-1-8 4-13 12-13zM109 255h158M122 267v22M244 267v22" />

      <path d="M248 220h249v10H248zM255 230h235v69l-53 13-182-13zM437 230v82M268 238v54" />
      <path d="M287 220v-37h57v37M297 154h56l-5 52h-46zM325 206v14M306 220h39M309 164h31" />

      <rect x="404" y="82" width="80" height="58" rx="2" /><rect x="410" y="88" width="68" height="46" rx="1" />
      <path d="M432 220v-18h27v18M440 202v-18M451 202v-18M439 188c-8-7-7-15-3-19 8 2 11 8 7 18M448 187c2-10 9-16 15-15 1 8-4 14-15 18" />

      <path d="M516 279V65h62v214M523 73h48v206M568 174h2M576 279h19" />
    </g>
    <g fill="currentColor" textAnchor="middle"><text x="444" y="103" fontSize="7">NOW SERVING</text><text x="444" y="125" fontSize="21" fontWeight="700">#06</text><text x="547" y="111" fontSize="6">CONSULTATION</text></g>
  </svg>;
}

export function LoginPage() {
  const { status, login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    const rememberedEmail = localStorage.getItem('clinic-queueing.remembered-email');
    if (rememberedEmail) {
      setEmail(rememberedEmail);
      setRememberMe(true);
    }
  }, []);

  if (status === 'authenticated') return <Navigate to="/app" replace />;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await login(email, password);
      if (rememberMe) localStorage.setItem('clinic-queueing.remembered-email', email.trim());
      else localStorage.removeItem('clinic-queueing.remembered-email');
      const from = (location.state as { from?: string } | null)?.from;
      navigate(from || '/app', { replace: true });
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Unable to sign in. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return <main className="sign-in-page">
    <section className="sign-in-brand-panel" aria-label="Clinic Queueing introduction">
      <Link className="sign-in-brand" to="/" aria-label="Clinic Queueing home"><span><Icon name="brand" /></span><strong>CLINIC QUEUEING<small>SaaS</small></strong></Link>
      <div className="sign-in-pitch">
        <h1>Smart queueing.<br />Better patient care.</h1>
        <p>A queue management system built for clinics<br className="desktop-only" /> to run efficiently and serve patients better.</p>
        <ul>
          <li><span><Icon name="calendar" /></span><div><strong>Organize Appointments</strong><p>Manage schedules and appointments with ease.</p></div></li>
          <li><span><Icon name="chart" /></span><div><strong>Real-time Queue</strong><p>See live queue status and keep patients informed.</p></div></li>
          <li><span><Icon name="shield" /></span><div><strong>Secure &amp; Reliable</strong><p>Your data is secure and accessible anytime.</p></div></li>
        </ul>
      </div>
      <ClinicIllustration />
    </section>

    <section className="sign-in-auth-panel">
      <div className="sign-in-language" aria-label="Language: English"><Icon name="globe" /><span>English</span></div>
      <div className="sign-in-center">
        <section className="sign-in-card" aria-labelledby="signin-heading">
          <header><h2 id="signin-heading">Sign in</h2><p>Welcome back! Please sign in to your account.</p></header>
          <form onSubmit={submit} noValidate>
            <label htmlFor="signin-email">Email address</label>
            <div className="sign-in-input"><Icon name="mail" /><input id="signin-email" type="email" autoComplete="email" required placeholder="Enter your email address" value={email} onChange={(event) => setEmail(event.target.value)} /></div>
            <label htmlFor="signin-password">Password</label>
            <div className="sign-in-input"><Icon name="lock" /><input id="signin-password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" required placeholder="Enter your password" value={password} onChange={(event) => setPassword(event.target.value)} /><button type="button" className="password-visibility" aria-label={showPassword ? 'Hide password' : 'Show password'} aria-pressed={showPassword} onClick={() => setShowPassword((visible) => !visible)}><Icon name={showPassword ? 'eyeOff' : 'eye'} /></button></div>
            <div className="sign-in-help"><label className="remember-me"><input type="checkbox" checked={rememberMe} onChange={(event) => setRememberMe(event.target.checked)} /><span>Remember me</span></label><Link to="/forgot-password">Forgot password?</Link></div>
            <span className="remember-email-note" id="remember-email-note">Only your email address is remembered on this device.</span>
            {error ? <div className="form-error" role="alert">{error}</div> : null}
            <button className="sign-in-submit" type="submit" disabled={submitting || !email || !password}>{submitting ? 'Signing in…' : 'Sign in'}</button>
            <div className="sign-in-divider" aria-hidden="true"><span>or</span></div>
            <button className="google-sign-in" type="button" disabled aria-describedby="google-coming-soon"><span className="google-mark" aria-hidden="true">G</span>Sign in with Google</button>
            <span className="google-coming-soon" id="google-coming-soon">Google sign-in is coming soon.</span>
          </form>
        </section>
        <div className="sign-in-account-entry">
          <Link to="/register/doctor">Create Doctor Account</Link><span aria-hidden="true">•</span><Link className="reactivation-link" to="/account/reactivate">Reactivate Account</Link>
        </div>
      </div>
    </section>
    <footer className="sign-in-footer"><div><p><Icon name="lock" /> Secure <span>•</span> Private <span>•</span> Compliant</p><p>© 2026 Clinic Queueing SaaS. All rights reserved.</p></div></footer>
  </main>;
}
