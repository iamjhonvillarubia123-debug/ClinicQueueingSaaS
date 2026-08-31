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
  return <svg className="clinic-illustration" viewBox="0 0 600 265" aria-hidden="true">
    <g fill="none" stroke="currentColor" strokeWidth="1.4">
      <path d="M248 240V62l292-44v222M467 240V72h56v168M478 86h34M478 99h34M511 155v2" />
      <path d="M216 186h246v54H216zM239 186v-27h92v27M257 139h55v20M268 148h33M330 196v44" />
      <rect x="350" y="86" width="88" height="57" rx="2" /><path d="M358 94h72v41" />
      <path d="M60 240v-63M60 190c-23-16-26-36-19-45 17 3 27 16 19 45M61 176c10-25 27-35 39-32 0 18-12 34-39 46M60 209c-17-14-34-15-43-8 6 17 21 24 43 23M61 215c16-17 33-20 44-14-4 17-20 27-44 27" />
      <path d="M41 240h40l-5 25H46zM92 240h122M99 240l-7-54h64l8 54M160 240l-7-54h61l8 54M111 186v-17M174 186v-17M98 215h117" />
      <circle cx="162" cy="112" r="25" /><path d="M162 91v22l12 8" />
      <path d="M292 139v-18h24v18M299 121v-7h10v7M369 165h19M378 143v22M405 240v-17M394 223h22" />
    </g>
    <g fill="currentColor" textAnchor="middle"><text x="394" y="105" fontSize="8">NOW SERVING</text><text x="394" y="126" fontSize="19" fontWeight="700">#06</text><text x="495" y="124" fontSize="7">CONSULTATION</text></g>
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
