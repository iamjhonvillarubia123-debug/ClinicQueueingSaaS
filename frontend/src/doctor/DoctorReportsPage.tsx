import { useEffect, useMemo, useState } from 'react';
import { apiRequest } from '../api/client';
import './DoctorReportsPage.css';

type ReportTab = 'overview' | 'queue' | 'services';

type PracticeLocation = {
  id: string;
  lifecycleStatus: 'DRAFT' | 'ACTIVE' | 'DISABLED' | 'PERMANENTLY_DELETED';
  name: string | null;
  cityMunicipality?: string | null;
  province?: string | null;
};

function Icon({ name }: { name: 'clinic' | 'calendar' | 'download' | 'users' | 'clock' | 'alert' | 'check' | 'info' | 'refresh' | 'service' | 'queue' }) {
  const common = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true };
  switch (name) {
    case 'clinic': return <svg {...common}><path d="M4 21V8h6v13M10 21V4h10v17M2 21h20" /><path d="M13 8h4M15 6v4" /></svg>;
    case 'calendar': return <svg {...common}><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M8 3v4M16 3v4M3 10h18" /></svg>;
    case 'download': return <svg {...common}><path d="M12 3v12m0 0 4-4m-4 4-4-4" /><path d="M5 19h14" /></svg>;
    case 'users': return <svg {...common}><circle cx="9" cy="8" r="3" /><path d="M3 20a6 6 0 0 1 12 0M16 7a3 3 0 0 1 0 6M18 15a5 5 0 0 1 3 5" /></svg>;
    case 'clock': return <svg {...common}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>;
    case 'alert': return <svg {...common}><circle cx="12" cy="8" r="3" /><path d="M5 21a7 7 0 0 1 14 0" /></svg>;
    case 'check': return <svg {...common}><circle cx="12" cy="12" r="9" /><path d="m8 12 2.5 2.5L16 9" /></svg>;
    case 'info': return <svg {...common}><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></svg>;
    case 'refresh': return <svg {...common}><path d="M20 6v5h-5" /><path d="M18.5 15a7 7 0 1 1-1.1-7.9L20 11" /></svg>;
    case 'service': return <svg {...common}><circle cx="12" cy="12" r="9" /><path d="M8 12h8M12 8v8" /></svg>;
    case 'queue': return <svg {...common}><circle cx="7" cy="7" r="2" /><circle cx="17" cy="7" r="2" /><path d="M3 16a4 4 0 0 1 8 0M13 16a4 4 0 0 1 8 0" /></svg>;
  }
}

function MetricCard({ icon, label, tone }: { icon: 'users' | 'clock' | 'alert' | 'check'; label: string; tone: 'green' | 'blue' | 'red' }) {
  return <section className="report-metric-card"><div className={`report-metric-icon ${tone}`}><Icon name={icon} /></div><div><span>{label}</span><strong>—</strong><small>Range reporting is not connected yet</small></div></section>;
}

function EmptyLineChart({ title, subtitle }: { title: string; subtitle: string }) {
  return <section className="report-card report-chart-card"><div className="report-card-heading"><div><h3>{title}</h3><p>{subtitle}</p></div></div><div className="report-line-chart" aria-label={`${title} chart placeholder`}><span className="grid g1" /><span className="grid g2" /><span className="grid g3" /><span className="grid g4" /><svg viewBox="0 0 520 180" preserveAspectRatio="none" aria-hidden="true"><polyline points="10,135 75,120 140,128 205,92 270,110 335,88 400,100 510,75" /></svg><div className="report-chart-empty">Awaiting aggregated report data</div></div></section>;
}

function Overview({ clinics }: { clinics: PracticeLocation[] }) {
  return <>
    <div className="report-metrics">
      <MetricCard icon="users" label="Patients Served" tone="green" />
      <MetricCard icon="clock" label="Average Wait Time" tone="blue" />
      <MetricCard icon="alert" label="No-Shows" tone="red" />
      <MetricCard icon="check" label="Completed Appointments" tone="green" />
    </div>
    <div className="report-overview-grid">
      <EmptyLineChart title="Patient Activity" subtitle="Patients served per day" />
      <section className="report-card"><div className="report-card-heading"><div><h3>Clinic Performance</h3><p>Comparison for the selected period</p></div></div><div className="report-clinic-list">{clinics.length ? clinics.map((clinic) => <div className="report-clinic-row" key={clinic.id}><div className="report-clinic-thumb"><Icon name="clinic" /></div><div className="report-clinic-copy"><strong>{clinic.name ?? 'Unnamed clinic'}</strong><span>{[clinic.cityMunicipality, clinic.province].filter(Boolean).join(', ') || 'Location not set'}</span></div><div><small>Patients Served</small><strong>—</strong></div><div><small>Avg Wait Time</small><strong>—</strong></div><b>›</b></div>) : <div className="report-empty">No clinics available.</div>}</div><button type="button" className="report-text-button">View detailed clinic report →</button></section>
      <section className="report-card"><div className="report-card-heading"><div><h3>Most Used Services</h3><p>By number of completed appointments</p></div></div>{['General Consultation','Follow-up Consultation','Health Screening','Vaccination','Others'].map((name, index) => <div className="report-service-row" key={name}><span className="report-service-icon"><Icon name="service" /></span><span>{name}</span><i style={{ width: `${76 - index * 11}%` }} /><strong>—</strong></div>)}<button type="button" className="report-text-button">View full services report →</button></section>
      <section className="report-card report-busiest"><div className="report-card-heading"><div><h3>Busiest Time</h3><p>Average number of patients in queue</p></div></div><div className="report-busiest-body"><span><Icon name="clock" /></span><div><strong>—</strong><p>Average queue size: — patients</p></div></div><button type="button" className="report-text-button">View queue performance report →</button></section>
    </div>
  </>;
}

function QueuePerformance({ clinics }: { clinics: PracticeLocation[] }) {
  return <>
    <div className="report-metrics"><MetricCard icon="queue" label="Total Queued" tone="blue" /><MetricCard icon="users" label="Average Queue Size" tone="green" /><MetricCard icon="clock" label="Longest Wait Time" tone="blue" /><MetricCard icon="alert" label="Left Without Being Served" tone="red" /></div>
    <div className="report-queue-grid"><section className="report-card"><div className="report-card-heading"><div><h3>Average Queue Size by Hour</h3><p>Average number of patients in queue</p></div></div><div className="report-bar-chart">{Array.from({ length: 10 }, (_, i) => <div key={i}><span style={{ height: `${22 + ((i * 17) % 54)}%` }} /><small>{8 + i > 12 ? 8 + i - 12 : 8 + i} {8 + i >= 12 ? 'PM' : 'AM'}</small></div>)}</div></section><section className="report-card"><div className="report-card-heading"><div><h3>Queue Outcome</h3><p>Distribution of queue results</p></div></div><div className="report-donut"><span>Awaiting<br/>data</span></div></section></div>
    <section className="report-card report-table-card"><div className="report-card-heading"><div><h3>Queue Performance by Clinic</h3></div></div><div className="report-table-wrap"><table><thead><tr><th>Clinic</th><th>Total Queued</th><th>Avg Queue Size</th><th>Avg Wait Time</th><th>Longest Wait Time</th><th>No-Shows</th><th>Left Without Served</th></tr></thead><tbody>{clinics.map((clinic) => <tr key={clinic.id}><td>{clinic.name ?? 'Unnamed clinic'}</td>{Array.from({ length: 6 }, (_, i) => <td key={i}>—</td>)}</tr>)}</tbody></table></div></section>
  </>;
}

function ServicesReport({ clinics }: { clinics: PracticeLocation[] }) {
  const services = ['General Consultation','Follow-up Consultation','Health Screening','Vaccination','Others'];
  return <><div className="report-services-top"><section className="report-card"><div className="report-card-heading"><div><h3>Services Summary</h3><p>By completed appointments</p></div></div>{services.map((service, i) => <div className="report-service-summary" key={service}><span>{service}</span><i style={{ width: `${68 - i * 9}%` }} /><strong>—</strong><small>—%</small></div>)}<button type="button" className="report-text-button">View full services report →</button></section><section className="report-card"><div className="report-card-heading"><div><h3>Average Duration by Service</h3><p>Average consultation time</p></div></div>{services.map((service) => <div className="report-duration-row" key={service}><span>{service}</span><strong>— min</strong></div>)}</section></div><section className="report-card report-table-card"><div className="report-card-heading"><div><h3>Services by Clinic</h3><p>Number of completed appointments</p></div></div><div className="report-table-wrap"><table><thead><tr><th>Service</th>{clinics.map((clinic) => <th key={clinic.id}>{clinic.name ?? 'Clinic'}<br/><small>Completed / %</small></th>)}<th>Total Completed</th></tr></thead><tbody>{services.map((service) => <tr key={service}><td>{service}</td>{clinics.map((clinic) => <td key={clinic.id}>— / —%</td>)}<td>—</td></tr>)}</tbody></table></div></section></>;
}

export function DoctorReportsPage() {
  const [tab, setTab] = useState<ReportTab>('overview');
  const [clinics, setClinics] = useState<PracticeLocation[]>([]);
  const [selectedClinicId, setSelectedClinicId] = useState('ALL');
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let active = true;
    void apiRequest<PracticeLocation[]>('/practice-location').then((items) => {
      if (!active) return;
      setClinics(items.filter((item) => item.lifecycleStatus !== 'PERMANENTLY_DELETED'));
    }).catch(() => { if (active) setLoadError(true); });
    return () => { active = false; };
  }, []);

  const visibleClinics = useMemo(() => selectedClinicId === 'ALL' ? clinics : clinics.filter((clinic) => clinic.id === selectedClinicId), [clinics, selectedClinicId]);

  return <div className="doctor-reports-page">
    <header className="doctor-reports-header"><div><h1>Reports</h1><p>See your clinic performance at a glance.</p></div><div className="report-filters"><label><Icon name="clinic"/><select aria-label="Clinic report filter" value={selectedClinicId} onChange={(event) => setSelectedClinicId(event.target.value)}><option value="ALL">All Clinics ({clinics.length})</option>{clinics.map((clinic) => <option value={clinic.id} key={clinic.id}>{clinic.name ?? 'Unnamed clinic'}</option>)}</select></label><button type="button" title="Date-range reporting backend is not connected yet"><Icon name="calendar"/> Aug 1 – Aug 14, 2026 ×</button><button type="button" title="Report export backend is not connected yet"><Icon name="download"/> Export</button></div></header>
    {loadError ? <p className="report-load-warning" role="status">Clinic filter data could not be loaded. Reporting UI remains available for review.</p> : null}
    <nav className="report-tabs" aria-label="Report views"><button className={tab === 'overview' ? 'active' : ''} onClick={() => setTab('overview')}>Overview</button><button className={tab === 'queue' ? 'active' : ''} onClick={() => setTab('queue')}>Queue Performance</button><button className={tab === 'services' ? 'active' : ''} onClick={() => setTab('services')}>Services</button></nav>
    <main className="report-content">{tab === 'overview' ? <Overview clinics={visibleClinics} /> : tab === 'queue' ? <QueuePerformance clinics={visibleClinics} /> : <ServicesReport clinics={visibleClinics} />}</main>
    <footer className="report-footer"><span><Icon name="info"/> Reports are based on completed data and may not reflect real-time changes.</span><span><Icon name="refresh"/> Last updated: awaiting connected reporting data</span></footer>
  </div>;
}
