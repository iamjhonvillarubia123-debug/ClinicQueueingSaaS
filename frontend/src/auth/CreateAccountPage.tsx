import { FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import clinicWaitingRoom from '../assets/clinic-waiting-room.jpg';

type AccountType = 'DOCTOR' | 'SECRETARY';
type IconName = 'brand' | 'calendar' | 'chart' | 'shield' | 'mail' | 'lock' | 'eye' | 'eyeOff' | 'globe' | 'person' | 'phone';

function Icon({ name }: { name: IconName }) {
  const paths: Record<IconName, React.ReactNode> = {
    brand: <path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6z" />,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M7 3v4M17 3v4M3 10h18M8 14h2M14 14h2M8 18h2" /></>,
    chart: <path d="M4 20V10M10 20V4M16 20v-7M22 20V7M2 20h22" />,
    shield: <path d="M12 2 4 5v6c0 5.4 3.4 9.3 8 11 4.6-1.7 8-5.6 8-11V5zM12 7v10M8 11l4 4 4-4" />,
    mail: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m4 7 8 6 8-6" /></>,
    lock: <><rect x="5" y="10" width="14" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3" /></>,
    eye: <><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z" /><circle cx="12" cy="12" r="2.5" /></>,
    eyeOff: <><path d="m3 3 18 18M10.6 6.2A10.7 10.7 0 0 1 12 6c6.5 0 10 6 10 6a18 18 0 0 1-2.1 2.8M6.6 6.6C3.6 8.3 2 12 2 12s3.5 6 10 6c1.1 0 2.1-.2 3-.5M9.9 9.9a3 3 0 0 0 4.2 4.2" /></>,
    globe: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.5 2.5 3.5 5.5 3.5 9S14.5 18.5 12 21M12 3C9.5 5.5 8.5 8.5 8.5 12S9.5 18.5 12 21" /></>,
    person: <><circle cx="12" cy="8" r="4" /><path d="M4.5 21a7.5 7.5 0 0 1 15 0" /></>,
    phone: <path d="M6.6 2.8 9.4 8l-2 1.7a15.5 15.5 0 0 0 6.9 6.9l1.7-2 5.2 2.8-1.3 3.1c-.4.9-1.3 1.5-2.3 1.4C9.1 21.1 2.9 14.9 2.1 6.4c-.1-1 .5-1.9 1.4-2.3z" />,
  };

  return <svg className="sign-in-icon" viewBox="0 0 24 24" aria-hidden="true">{paths[name]}</svg>;
}

export function CreateAccountPage() {
  const navigate = useNavigate();
  const [accountType, setAccountType] = useState<AccountType>('DOCTOR');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [mobileNumber, setMobileNumber] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [error, setError] = useState('');

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    if (!termsAccepted) {
      setError('Please accept the Terms of Service and Privacy Policy.');
      return;
    }
    const params = new URLSearchParams({ email: email.trim(), role: accountType });
    navigate(`/registration/check-email?${params.toString()}`);
  }

  return (
    <main className="sign-in-page create-account-page">
      <section className="sign-in-brand-panel" aria-label="Clinic Queueing introduction">
        <div className="sign-in-brand-content">
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
          <img className="clinic-illustration" src={clinicWaitingRoom} alt="" aria-hidden="true" decoding="async" />
        </div>
      </section>

      <section className="sign-in-auth-panel create-account-auth-panel">
        <div className="sign-in-auth-content create-account-auth-content">
          <div className="sign-in-language" aria-label="Language: English"><Icon name="globe" /><span>English</span></div>
          <div className="sign-in-center create-account-center">
            <section className="create-account-card" aria-labelledby="create-account-heading">
              <header><h2 id="create-account-heading">Create your account</h2><p>Get started with Clinic Queueing.</p></header>
              <form aria-label="Create account form" onSubmit={submit}>
                <fieldset className="account-type-fieldset">
                  <legend>Account type</legend>
                  <div className="account-type-grid">
                    <label className={`account-type-card ${accountType === 'DOCTOR' ? 'is-selected' : ''}`}><input type="radio" name="account-type" value="DOCTOR" checked={accountType === 'DOCTOR'} onChange={() => setAccountType('DOCTOR')} /><Icon name="person" /><span><strong>Doctor</strong><small>Manage your clinics, appointments, and queue operations.</small></span></label>
                    <label className={`account-type-card ${accountType === 'SECRETARY' ? 'is-selected' : ''}`}><input type="radio" name="account-type" value="SECRETARY" checked={accountType === 'SECRETARY'} onChange={() => setAccountType('SECRETARY')} /><Icon name="person" /><span><strong>Secretary</strong><small>Work with clinics that assign you as a Secretary.</small></span></label>
                  </div>
                </fieldset>
                <div className="create-account-two-column">
                  <label>First name<div className="create-account-input"><Icon name="person" /><input required type="text" autoComplete="given-name" placeholder="Enter your first name" value={firstName} onChange={(event) => setFirstName(event.target.value)} /></div></label>
                  <label>Last name<div className="create-account-input"><Icon name="person" /><input required type="text" autoComplete="family-name" placeholder="Enter your last name" value={lastName} onChange={(event) => setLastName(event.target.value)} /></div></label>
                </div>
                <label>Email address<div className="create-account-input"><Icon name="mail" /><input required type="email" autoComplete="email" placeholder="Enter your email address" value={email} onChange={(event) => setEmail(event.target.value)} /></div></label>
                <label>Mobile number<div className="create-account-input"><Icon name="phone" /><input required type="tel" autoComplete="tel" placeholder="Enter your mobile number" value={mobileNumber} onChange={(event) => setMobileNumber(event.target.value)} /></div></label>
                <div className="create-account-two-column">
                  <label>Password<div className="create-account-input"><Icon name="lock" /><input required type={showPassword ? 'text' : 'password'} autoComplete="new-password" placeholder="Create a password" value={password} onChange={(event) => setPassword(event.target.value)} /><button type="button" className="password-visibility" aria-label={showPassword ? 'Hide password' : 'Show password'} aria-pressed={showPassword} onClick={() => setShowPassword((visible) => !visible)}><Icon name={showPassword ? 'eyeOff' : 'eye'} /></button></div></label>
                  <label>Confirm password<div className="create-account-input"><Icon name="lock" /><input required type={showConfirmPassword ? 'text' : 'password'} autoComplete="new-password" placeholder="Re-enter your password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} /><button type="button" className="password-visibility" aria-label={showConfirmPassword ? 'Hide confirm password' : 'Show confirm password'} aria-pressed={showConfirmPassword} onClick={() => setShowConfirmPassword((visible) => !visible)}><Icon name={showConfirmPassword ? 'eyeOff' : 'eye'} /></button></div></label>
                </div>
                <label className="create-account-consent"><input type="checkbox" checked={termsAccepted} onChange={(event) => setTermsAccepted(event.target.checked)} /><span>I agree to the <button type="button" className="inline-link">Terms of Service</button> and <button type="button" className="inline-link">Privacy Policy</button></span></label>
                {error ? <div className="form-error" role="alert">{error}</div> : null}
                <button className="create-account-submit" type="submit">Create account</button>
              </form>
              <p className="create-account-signin">Already have an account? <Link to="/login">Sign in</Link></p>
            </section>
          </div>
        </div>
      </section>
      <footer className="sign-in-footer"><div><p><Icon name="lock" /> Secure <span>•</span> Private <span>•</span> Compliant</p><p>© 2026 Clinic Queueing SaaS. All rights reserved.</p></div></footer>
    </main>
  );
}
