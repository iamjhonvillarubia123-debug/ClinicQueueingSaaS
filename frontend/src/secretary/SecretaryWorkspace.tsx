import { Navigate, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

type SecretaryIconName = 'home' | 'settings' | 'signout';

function SecretaryIcon({ name }: { name: SecretaryIconName }) {
  const common = {
    width: 24,
    height: 24,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  };

  if (name === 'home') {
    return <svg {...common}><path d="M3 10.5 12 3l9 7.5" /><path d="M5.5 9.5V21h13V9.5" /><path d="M9.5 21v-7h5v7" /></svg>;
  }
  if (name === 'settings') {
    return <svg {...common}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21H9.6v-.1A1.7 1.7 0 0 0 8.5 19.3a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.1 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H2V9.6h.1A1.7 1.7 0 0 0 3.7 8.5a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 8.1 4.1a1.7 1.7 0 0 0 1-.6A1.7 1.7 0 0 0 9.5 2H14v.1a1.7 1.7 0 0 0 1.1 1.6 1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.5 8.1c.16.37.43.7.78.94.34.24.75.37 1.17.37H22v4h-.1A1.7 1.7 0 0 0 20.3 14c-.4.28-.7.62-.9 1Z" /></svg>;
  }
  return <svg {...common}><path d="M10 17l5-5-5-5M15 12H3" /><path d="M14 3h5a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-5" /></svg>;
}

function BrandMark() {
  return <span className="doctor-brand-mark" aria-hidden="true"><span>+</span></span>;
}

export function SecretaryOnly() {
  const { profile } = useAuth();
  return profile?.role === 'SECRETARY' ? <Outlet /> : <Navigate to="/app" replace />;
}

export function SecretaryWorkspaceShell() {
  const { logout } = useAuth();
  const navigate = useNavigate();

  async function signOut() {
    await logout();
    navigate('/login', { replace: true });
  }

  return (
    <div className="doctor-workspace-shell secretary-workspace-shell">
      <header className="doctor-workspace-header">
        <div className="doctor-header-left">
          <button className="doctor-menu-button" type="button" aria-label="Workspace navigation"><span /><span /><span /></button>
          <NavLink className="doctor-brand" to="/app/secretary" aria-label="Clinic Queueing secretary home">
            <BrandMark />
            <span className="doctor-brand-copy"><strong>CLINIC QUEUEING</strong><small>SaaS</small></span>
          </NavLink>
        </div>
        <div className="doctor-account-summary" aria-label="Signed in secretary account">
          <span className="doctor-avatar" aria-hidden="true"><svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></svg></span>
          <span className="doctor-account-copy"><small>SECRETARY</small><strong>Secretary account</strong></span>
          <span className="doctor-account-chevron" aria-hidden="true">⌄</span>
        </div>
      </header>
      <div className="doctor-workspace-layout">
        <aside className="doctor-sidebar" aria-label="Secretary workspace navigation">
          <nav className="doctor-nav-list">
            <NavLink to="/app/secretary" end className={({ isActive }) => `doctor-nav-item${isActive ? ' is-active' : ''}`}><SecretaryIcon name="home" /><span>Home</span></NavLink>
            <NavLink to="/app/secretary/settings" className={({ isActive }) => `doctor-nav-item${isActive ? ' is-active' : ''}`}><SecretaryIcon name="settings" /><span>Settings</span></NavLink>
          </nav>
          <button className="doctor-signout" type="button" onClick={() => void signOut()}><SecretaryIcon name="signout" /><span>Sign Out</span></button>
        </aside>
        <main className="doctor-workspace-content"><Outlet /></main>
      </div>
    </div>
  );
}

export function SecretaryWorkspacePlaceholder({ title, description }: { title: string; description: string }) {
  return (
    <section className="doctor-placeholder-page">
      <p className="doctor-placeholder-eyebrow">Secretary workspace</p>
      <h1>{title}</h1>
      <p>{description}</p>
      <div className="doctor-placeholder-rule" />
      <p className="doctor-placeholder-note">This area is intentionally empty until its approved UI is designed.</p>
    </section>
  );
}
