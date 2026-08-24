import { Link } from 'react-router-dom';

type ClinicTab = 'details' | 'staff' | 'services';

export function ClinicConfigurationTabs({ practiceLocationId, active }: { practiceLocationId: string; active: ClinicTab }) {
  const base = `/app/practice-locations/${encodeURIComponent(practiceLocationId)}`;
  return (
    <nav className="clinic-config-tabs" aria-label="Clinic configuration sections">
      <Link className={`clinic-config-tab${active === 'details' ? ' is-active' : ''}`} aria-current={active === 'details' ? 'page' : undefined} to={base}>Clinic details</Link>
      <Link className={`clinic-config-tab${active === 'staff' ? ' is-active' : ''}`} aria-current={active === 'staff' ? 'page' : undefined} to={`${base}/staff`}>Staff</Link>
      <Link className={`clinic-config-tab${active === 'services' ? ' is-active' : ''}`} aria-current={active === 'services' ? 'page' : undefined} to={`${base}/services-questions`}>Services & questions</Link>
    </nav>
  );
}
