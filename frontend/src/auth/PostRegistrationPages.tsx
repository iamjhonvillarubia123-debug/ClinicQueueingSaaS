import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ApiError, apiRequest } from '../api/client';
import clinicWaitingRoom from '../assets/clinic-waiting-room.jpg';

type AccountType = 'DOCTOR' | 'SECRETARY';
type IconName = 'brand' | 'calendar' | 'chart' | 'shield' | 'lock' | 'globe' | 'mail' | 'check' | 'clipboard' | 'person' | 'building' | 'settings' | 'inbox';

function Icon({ name }: { name: IconName }) {
  const paths: Record<IconName, React.ReactNode> = {
    brand: <path d="M9 3h6v6h6v6H9v-6H3V9h6z" />,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M7 3v4M17 3v4M3 10h18M8 14h2M14 14h2M8 18h2" /></>,
    chart: <path d="M4 20V10M10 20V4M16 20v-7M22 20V7M2 20h22" />,
    shield: <path d="M12 2 4 5v6c0 5.4 3.4 9.3 8 11 4.6-1.7 8-5.6 8-11V5zM12 7v10M8 11l4 4 4-4" />,
    lock: <><rect x="5" y="10" width="14" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3" /></>,
    globe: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.5 2.5 3.5 5.5 3.5 9S14.5 18.5 12 21M12 3C9.5 5.5 8.5 8.5 8.5 12S9.5 18.5 12 21" /></>,
    mail: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m4 7 8 6 8-6" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    clipboard: <><rect x="5" y="4" width="14" height="17" rx="2" /><path d="M9 4V2h6v2M8 9h8M8 13h8M8 17h6" /></>,
    person: <><circle cx="12" cy="8" r="4" /><path d="M4.5 21a7.5 7.5 0 0 1 15 0" /></>,
    building: <><path d="M4 21V8l8-4 8 4v13M8 11h2M14 11h2M8 15h2M14 15h2M10 21v-3h4v3" /></>,
    settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6V21h-4v-.1A1.7 1.7 0 0 0 9 19.3a1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H3v-4h.1A1.7 1.7 0 0 0 4.7 9a1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6 1.7 1.7 0 0 0 10 3V3h4v.1A1.7 1.7 0 0 0 15 4.7a1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1H21v4h-.1a1.7 1.7 0 0 0-1.5 1z" /></>,
    inbox: <><path d="M4 6h16l2 8v6H2v-6z" /><path d="M2 14h6l2 3h4l2-3h6" /></>,
  };
  return <svg className="sign-in-icon" viewBox="0 0 24 24" aria-hidden="true">{paths[name]}</svg>;
}

function JourneyFrame({ children }: { children: React.ReactNode }) {
  return (
    <main className="sign-in-page registration-journey-page">
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
      <section className="sign-in-auth-panel registration-journey-auth-panel">
        <div className="sign-in-auth-content registration-journey-auth-content">
          <div className="sign-in-language" aria-label="Language: English"><Icon name="globe" /><span>English</span></div>
          <div className="registration-journey-center">{children}</div>
        </div>
      </section>
      <footer className="sign-in-footer"><div><p><Icon name="lock" /> Secure <span>•</span> Private <span>•</span> Compliant</p><p>© 2026 Clinic Queueing SaaS. All rights reserved.</p></div></footer>
    </main>
  );
}

function readRole(value: string | null): AccountType {
  return value === 'SECRETARY' ? 'SECRETARY' : 'DOCTOR';
}

export function RegistrationCheckEmailPage() {
  const [searchParams] = useSearchParams();
  const email = searchParams.get('email')?.trim() || 'your email address';
  const [resending, setResending] = useState(false);
  const [message, setMessage] = useState('');

  async function resend() {
    if (resending || email === 'your email address') return;
    setResending(true);
    setMessage('');
    try {
      await apiRequest('/auth/resend-email-verification', {
        method: 'POST',
        body: { email },
      });
      setMessage('A new verification email has been requested.');
    } catch (caught) {
      setMessage(caught instanceof ApiError ? caught.message : 'Unable to resend the verification email right now.');
    } finally {
      setResending(false);
    }
  }

  return (
    <JourneyFrame>
      <section className="registration-state-card" aria-labelledby="check-email-heading">
        <div className="registration-state-icon"><Icon name="mail" /><span><Icon name="check" /></span></div>
        <h2 id="check-email-heading">Verify your email</h2>
        <p>We sent a verification link to</p>
        <strong className="registration-state-email">{email}</strong>
        <p>Open the link in your email to verify your account.</p>
        <button className="registration-secondary-action" type="button" disabled={resending} onClick={() => void resend()}>{resending ? 'Sending…' : 'Resend verification email'}</button>
        {message ? <p className="registration-state-footnote" role="status">{message}</p> : null}
        <p className="registration-state-footnote">Wrong email? <Link to="/register">Go back</Link></p>
      </section>
    </JourneyFrame>
  );
}

export function RegistrationAccountReadyPage() {
  const [searchParams] = useSearchParams();
  const role = readRole(searchParams.get('role'));
  const next = role === 'DOCTOR' ? '/registration/doctor-onboarding' : '/registration/secretary-home';
  return (
    <JourneyFrame>
      <section className="registration-state-card registration-ready-card" aria-labelledby="account-ready-heading">
        <div className="registration-state-icon registration-check-icon"><Icon name="check" /></div>
        <h2 id="account-ready-heading">Your account is ready!</h2>
        <p>Your {role === 'DOCTOR' ? 'Doctor' : 'Secretary'} account has been verified.</p>
        <Link className="registration-primary-action" to={next}>Continue</Link>
      </section>
    </JourneyFrame>
  );
}

export function DoctorOnboardingPage() {
  return (
    <JourneyFrame>
      <section className="registration-state-card registration-onboarding-card" aria-labelledby="doctor-onboarding-heading">
        <div className="registration-state-icon"><Icon name="clipboard" /><span><Icon name="person" /></span></div>
        <h2 id="doctor-onboarding-heading">Let's get you started</h2>
        <p>Set up your profile and create your first clinic.</p>
        <div className="registration-next-list">
          <div><span><Icon name="person" /></span><p><strong>Complete your profile</strong><small>Add your professional details</small></p></div>
          <div><span><Icon name="building" /></span><p><strong>Create your clinic</strong><small>Set up your practice location</small></p></div>
          <div><span><Icon name="settings" /></span><p><strong>Configure settings</strong><small>Set your clinic preferences</small></p></div>
        </div>
        <Link className="registration-primary-action" to="/app/settings">Start setup</Link>
      </section>
    </JourneyFrame>
  );
}

export function SecretaryNoAssignmentsPage() {
  return (
    <JourneyFrame>
      <section className="registration-state-card registration-secretary-card" aria-labelledby="secretary-home-heading">
        <div className="registration-state-icon"><Icon name="inbox" /></div>
        <h2 id="secretary-home-heading">Welcome to<br />Clinic Queueing!</h2>
        <div className="registration-empty-state">
          <strong>No clinic assignments yet</strong>
          <p>Your Secretary account is ready. Clinics will appear here when a Doctor assigns you as a Secretary.</p>
        </div>
        <h3>What's next?</h3>
        <div className="registration-next-list secretary-next-list">
          <div><span><Icon name="person" /></span><p>Wait for a Doctor to assign you</p></div>
          <div><span><Icon name="calendar" /></span><p>Once assigned, you can manage appointments and queues</p></div>
          <div><span><Icon name="building" /></span><p>You can work with multiple clinics</p></div>
        </div>
        <Link className="registration-primary-action" to="/app/secretary/settings">Continue to settings</Link>
      </section>
    </JourneyFrame>
  );
}
