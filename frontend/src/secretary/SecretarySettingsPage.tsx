import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import './SecretarySettingsPage.css';

type SettingsIconName = 'account' | 'security' | 'preferences' | 'info';

function SettingsIcon({ name }: { name: SettingsIconName }) {
  if (name === 'account') return <span aria-hidden="true">●</span>;
  if (name === 'security') return <span aria-hidden="true">▣</span>;
  if (name === 'preferences') return <span aria-hidden="true">♢</span>;
  return <span aria-hidden="true">i</span>;
}

export function SecretarySettingsPage() {
  const { profile } = useAuth();
  const isSecretary = profile?.role === 'SECRETARY';

  return (
    <div className="secretary-settings-page">
      <header className="secretary-settings-heading">
        <h1>Settings</h1>
        <p>Manage your account and preferences.</p>
      </header>

      <section className="secretary-settings-card account-card">
        <div className="secretary-settings-icon"><SettingsIcon name="account" /></div>
        <div className="secretary-settings-account-copy">
          <h2>Account</h2>
          <h3>Secretary account</h3>
          <span className="secretary-settings-role">Secretary</span>
          <p>Account identity details are not exposed by the current authenticated profile API.</p>
        </div>
        <dl className="secretary-settings-account-meta">
          <div><dt>Role</dt><dd>{isSecretary ? 'Secretary' : '—'}</dd></div>
          <div><dt>Account status</dt><dd><span className="secretary-settings-status">Active</span></dd></div>
          <div><dt>Last sign in</dt><dd>—</dd></div>
        </dl>
        <Link className="secretary-settings-action" to="/app/secretary/profile">View account <span>›</span></Link>
      </section>

      <section className="secretary-settings-card">
        <div className="secretary-settings-icon"><SettingsIcon name="security" /></div>
        <div className="secretary-settings-copy">
          <h2>Security</h2>
          <h3>Password and account security</h3>
          <p className="secretary-settings-secure">● Your account is secure</p>
        </div>
        <Link className="secretary-settings-action" to="/app/account">Manage security <span>›</span></Link>
      </section>

      <section className="secretary-settings-card">
        <div className="secretary-settings-icon"><SettingsIcon name="preferences" /></div>
        <div className="secretary-settings-copy">
          <h2>Preferences</h2>
          <h3>Display and notification preferences</h3>
          <p>Set your language, time zone, and notification preferences.</p>
        </div>
        <button className="secretary-settings-action" type="button" disabled title="Secretary preferences backend is not connected yet">Manage preferences <span>›</span></button>
      </section>

      <section className="secretary-settings-note">
        <span className="secretary-settings-note-icon"><SettingsIcon name="info" /></span>
        <div><strong>Note</strong><p>These settings apply to your account only and do not change clinic operations.</p></div>
      </section>
    </div>
  );
}
