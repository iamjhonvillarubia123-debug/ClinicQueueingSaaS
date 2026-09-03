import { useSearchParams } from 'react-router-dom';
import { AccountSettings } from './settings/AccountSettings';
import { DefaultSettings } from './settings/DefaultSettings';
import { NotificationSettings } from './settings/NotificationSettings';
import { PrivacySettings } from './settings/PrivacySettings';
import { AuditSettings } from './settings/AuditSettings';
import '../styles/doctor-settings.css';

const tabs = [
  ['account', 'Account & Security'],
  ['defaults', 'Doctor Defaults'],
  ['notifications', 'Notifications'],
  ['privacy', 'Data & Privacy'],
  ['audit', 'Audit Log'],
] as const;
export function DoctorSettingsPage() {
  const [params, setParams] = useSearchParams();
  const selected = tabs.some(([id]) => id === params.get('tab'))
    ? params.get('tab')!
    : 'account';
  const changeTab = (id: string) => setParams({ tab: id });
  return (
    <section
      className="doctor-settings"
      aria-labelledby="doctor-settings-title"
    >
      <header className="ds-heading">
        <h1 id="doctor-settings-title">Settings</h1>
        <p>Manage your account, defaults, and system settings.</p>
      </header>
      <nav className="ds-tabs" aria-label="Settings sections">
        {tabs.map(([id, label]) => (
          <button
            key={id}
            aria-current={selected === id ? 'page' : undefined}
            onClick={() => changeTab(id)}
          >
            {label}
          </button>
        ))}
      </nav>
      <div className="ds-layout" key={selected}>
        {selected === 'account' && <AccountSettings />}
        {selected === 'defaults' && <DefaultSettings />}
        {selected === 'notifications' && <NotificationSettings />}
        {selected === 'privacy' && (
          <PrivacySettings onAccount={() => changeTab('account')} />
        )}
        {selected === 'audit' && <AuditSettings />}
      </div>
    </section>
  );
}
