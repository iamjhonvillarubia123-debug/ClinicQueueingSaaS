import { type ReactNode, useState } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth, type UserRole } from '../auth/AuthContext';
import { ClinicConfigurationTabs } from '../doctor/ClinicConfigurationTabs';

type NavItem = {
  label: string;
  to: string;
  icon: ReactNode;
  matches: (pathname: string) => boolean;
};

function Icon({ children }: { children: ReactNode }) {
  return <svg className="app-shell-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{children}</svg>;
}

const icons = {
  clinics: <Icon><path d="M4 21V7l8-4 8 4v14" /><path d="M8 21v-4h8v4M8 9h2m4 0h2m-8 4h2m4 0h2" /></Icon>,
  reviews: <Icon><path d="M7 3h10v4H7z" /><path d="M5 5v16h14V5M8 12h8m-8 4h5" /></Icon>,
  defaults: <Icon><path d="M4 6h10M18 6h2M4 12h2m4 0h10M4 18h7m4 0h5" /><circle cx="16" cy="6" r="2" /><circle cx="8" cy="12" r="2" /><circle cx="13" cy="18" r="2" /></Icon>,
  privacy: <Icon><path d="M12 3 5 6v5c0 4.6 2.8 8.2 7 10 4.2-1.8 7-5.4 7-10V6l-7-3Z" /><path d="m9 12 2 2 4-4" /></Icon>,
  account: <Icon><circle cx="12" cy="8" r="4" /><path d="M4 21c.8-4.2 3.5-6 8-6s7.2 1.8 8 6" /></Icon>,
  help: <Icon><circle cx="12" cy="12" r="9" /><path d="M9.8 9a2.4 2.4 0 0 1 4.6.9c0 1.7-2.4 2-2.4 3.8M12 17h.01" /></Icon>,
};

function roleLabel(role?: UserRole) {
  if (!role) return '';
  return role === 'SYSTEM_ADMIN' ? 'SYSTEM ADMIN' : role;
}

function navigation(role: UserRole | undefined): NavItem[] {
  if (role === 'DOCTOR') {
    return [
      { label: 'Clinics', to: '/app/practice-locations', icon: icons.clinics, matches: (path) => path.startsWith('/app/practice-locations') },
      { label: 'Reviews', to: '/app/secretary-draft-reviews', icon: icons.reviews, matches: (path) => path.startsWith('/app/secretary-draft-reviews') },
      { label: 'Defaults', to: '/app/defaults', icon: icons.defaults, matches: (path) => path.startsWith('/app/defaults') },
      { label: 'Data & Privacy', to: '/app/data-privacy', icon: icons.privacy, matches: (path) => path.startsWith('/app/data-privacy') },
      { label: 'Account', to: '/app/account', icon: icons.account, matches: (path) => path.startsWith('/app/account') },
    ];
  }
  if (role === 'SECRETARY') {
    return [
      { label: 'Clinics', to: '/app/secretary/clinics', icon: icons.clinics, matches: (path) => path.startsWith('/app/secretary/') },
      { label: 'Account', to: '/app/account', icon: icons.account, matches: (path) => path.startsWith('/app/account') },
    ];
  }
  return [];
}

export function AppShell() {
  const { profile, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  async function signOut() {
    await logout();
    navigate('/login', { replace: true });
  }

  const items = navigation(profile?.role);
  const clinicRoute = /^\/app\/practice-locations\/([^/]+)(?:\/(services-questions))?$/.exec(location.pathname);
  const clinicTabs = profile?.role === 'DOCTOR' && clinicRoute
    ? <ClinicConfigurationTabs practiceLocationId={decodeURIComponent(clinicRoute[1])} active={clinicRoute[2] ? 'services' : 'details'} />
    : null;

  return <div className="app-shell">
    <header className="app-shell-topbar">
      <button className="app-shell-mobile-trigger" type="button" aria-label="Open navigation" aria-expanded={mobileNavOpen} onClick={() => setMobileNavOpen(true)}>
        <span /><span /><span />
      </button>
      <Link className="app-shell-brand" to="/app">Clinic Queueing</Link>
      <div className="app-shell-topbar-context">
        <span className="app-shell-role">{roleLabel(profile?.role)}</span>
        {(profile?.role === 'DOCTOR' || profile?.role === 'SECRETARY') ? <details className="app-shell-account-menu">
          <summary>Account <span aria-hidden="true">⌄</span></summary>
          <div className="app-shell-account-popover">
            <Link to="/app/account">Account settings</Link>
            <button type="button" onClick={() => void signOut()}>Sign out</button>
          </div>
        </details> : null}
      </div>
    </header>

    {mobileNavOpen ? <button className="app-shell-mobile-backdrop" type="button" aria-label="Close navigation" onClick={() => setMobileNavOpen(false)} /> : null}

    <aside className={`app-shell-sidebar${mobileNavOpen ? ' mobile-open' : ''}`} aria-label="Workspace navigation">
      <div className="app-shell-sidebar-mobile-head">
        <strong>Clinic Queueing</strong>
        <button type="button" aria-label="Close navigation" onClick={() => setMobileNavOpen(false)}>×</button>
      </div>
      <nav className="app-shell-nav">
        {items.map((item) => <Link key={item.to} className={item.matches(location.pathname) ? 'active' : ''} to={item.to} onClick={() => setMobileNavOpen(false)}>
          {item.icon}<span>{item.label}</span>
        </Link>)}
      </nav>
      <div className="app-shell-sidebar-footer">
        <span>{icons.help}</span><span>Help & support</span>
      </div>
    </aside>

    <main className="app-shell-workspace">
      <div className="app-shell-content-frame">
        {clinicTabs}
        <Outlet />
      </div>
    </main>
  </div>;
}
