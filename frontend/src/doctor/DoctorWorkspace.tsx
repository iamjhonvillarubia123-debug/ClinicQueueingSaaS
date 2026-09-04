import { Navigate, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

type WorkspaceIconName = 'overview' | 'profile' | 'clinics' | 'calendar' | 'secretaries' | 'reports' | 'settings' | 'billing' | 'signout';

type WorkspaceNavItem = {
  to: string;
  label: string;
  icon: WorkspaceIconName;
};

const doctorNavigation: WorkspaceNavItem[] = [
  { to: '/app/overview', label: 'Overview', icon: 'overview' },
  { to: '/app/profile', label: 'Profile', icon: 'profile' },
  { to: '/app/clinics', label: 'Clinics', icon: 'clinics' },
  { to: '/app/calendar', label: 'Calendar', icon: 'calendar' },
  { to: '/app/secretaries', label: 'Secretaries', icon: 'secretaries' },
  { to: '/app/reports', label: 'Reports', icon: 'reports' },
  { to: '/app/settings', label: 'Settings', icon: 'settings' },
  { to: '/app/billing', label: 'Billing', icon: 'billing' },
];

function WorkspaceIcon({ name }: { name: WorkspaceIconName }) {
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

  switch (name) {
    case 'overview':
      return <svg {...common}><path d="M3 10.5 12 3l9 7.5" /><path d="M5.5 9.5V21h13V9.5" /><path d="M9.5 21v-7h5v7" /></svg>;
    case 'profile':
      return <svg {...common}><circle cx="12" cy="8" r="4" /><path d="M4.5 21a7.5 7.5 0 0 1 15 0" /></svg>;
    case 'clinics':
      return <svg {...common}><path d="M4 21V8h6v13" /><path d="M10 21V4h10v17" /><path d="M2 21h20" /><path d="M13 8h4M15 6v4M7 11h1M7 15h1M13 14h1M17 14h1M13 18h1M17 18h1" /></svg>;
    case 'calendar':
      return <svg {...common}><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M8 3v4M16 3v4M3 10h18" /><path d="M8 14h.01M12 14h.01M16 14h.01M8 17h.01M12 17h.01" /></svg>;
    case 'secretaries':
      return <svg {...common}><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></svg>;
    case 'reports':
      return <svg {...common}><path d="M4 20V10" /><path d="M10 20V4" /><path d="M16 20v-7" /><path d="M22 20H2" /></svg>;
    case 'settings':
      return <svg {...common}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21H9.6v-.1A1.7 1.7 0 0 0 8.5 19.3a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.1 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H2V9.6h.1A1.7 1.7 0 0 0 3.7 8.5a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 8.1 4.1a1.7 1.7 0 0 0 1-.6A1.7 1.7 0 0 0 9.5 2H14v.1a1.7 1.7 0 0 0 1.1 1.6 1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.5 8.1c.16.37.43.7.78.94.34.24.75.37 1.17.37H22v4h-.1A1.7 1.7 0 0 0 20.3 14c-.4.28-.7.62-.9 1Z" /></svg>;
    case 'billing':
      return <svg {...common}><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 9h18M7 14h4" /></svg>;
    case 'signout':
      return <svg {...common}><path d="M10 17l5-5-5-5M15 12H3" /><path d="M14 3h5a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-5" /></svg>;
  }
}

function BrandMark() {
  return (
    <span className="doctor-brand-mark" aria-hidden="true">
      <span>+</span>
    </span>
  );
}

export function DoctorOnly() {
  const { profile } = useAuth();
  return profile?.role === 'DOCTOR' ? <Outlet /> : <Navigate to="/app" replace />;
}

export function DoctorWorkspaceShell() {
  const { logout } = useAuth();
  const navigate = useNavigate();

  async function signOut() {
    await logout();
    navigate('/login', { replace: true });
  }

  return (
    <div className="doctor-workspace-shell">
      <header className="doctor-workspace-header">
        <div className="doctor-header-left">
          <button className="doctor-menu-button" type="button" aria-label="Workspace navigation">
            <span /><span /><span />
          </button>
          <NavLink className="doctor-brand" to="/app/overview" aria-label="Clinic Queueing overview">
            <BrandMark />
            <span className="doctor-brand-copy">
              <strong>CLINIC QUEUEING</strong>
              <small>SaaS</small>
            </span>
          </NavLink>
        </div>

        <div className="doctor-account-summary" aria-label="Signed in doctor account">
          <span className="doctor-avatar" aria-hidden="true">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></svg>
          </span>
          <span className="doctor-account-copy">
            <small>DOCTOR</small>
            <strong>Doctor account</strong>
          </span>
          <span className="doctor-account-chevron" aria-hidden="true">⌄</span>
        </div>
      </header>

      <div className="doctor-workspace-layout">
        <aside className="doctor-sidebar" aria-label="Doctor workspace navigation">
          <nav className="doctor-nav-list">
            {doctorNavigation.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) => `doctor-nav-item${isActive ? ' is-active' : ''}`}
              >
                <WorkspaceIcon name={item.icon} />
                <span>{item.label}</span>
              </NavLink>
            ))}
          </nav>

          <button className="doctor-signout" type="button" onClick={() => void signOut()}>
            <WorkspaceIcon name="signout" />
            <span>Sign Out</span>
          </button>
        </aside>

        <main className="doctor-workspace-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

type PlaceholderProps = {
  eyebrow?: string;
  title: string;
  description: string;
};

export function DoctorWorkspacePlaceholder({ eyebrow = 'Doctor workspace', title, description }: PlaceholderProps) {
  return (
    <section className="doctor-placeholder-page">
      <p className="doctor-placeholder-eyebrow">{eyebrow}</p>
      <h1>{title}</h1>
      <p>{description}</p>
      <div className="doctor-placeholder-rule" />
      <p className="doctor-placeholder-note">This area is intentionally not connected to clinic data yet.</p>
    </section>
  );
}
