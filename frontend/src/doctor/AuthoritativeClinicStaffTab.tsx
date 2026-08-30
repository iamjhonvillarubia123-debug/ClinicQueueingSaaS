import { useEffect, useMemo, useState } from 'react';
import { apiRequest } from '../api/client';

type StaffFilter = 'ALL' | 'ACTIVE' | 'DISABLED' | 'PENDING';
export type SubstituteCoverage = { id: string; coverageMode: 'ONE_SERVICE_DATE' | 'DATE_RANGE'; fromServiceDate: string; toServiceDate: string; status: 'ACTIVE' | 'CANCELLED' | 'SUPERSEDED'; createdAt: string; endedAt: string | null };
export type ClinicStaffAssignment = { practiceStaffId: string; userId: string; name: string; email: string; mobileNumber: string; assignmentActive: boolean; operationallyReady: boolean; isClinicSecretary: boolean; assignedAt: string; deactivatedAt: string | null; updatedAt: string; authorityBundles: string[]; substituteCoverages: SubstituteCoverage[] };
export type StaffCandidate = { userId: string; name: string; email: string; mobileNumber: string };
export type AuthoritativeClinicStaff = { clinic: { id: string; name: string | null }; staffAssignments: ClinicStaffAssignment[]; candidates: StaffCandidate[] };

function initials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? '').join('') || '?';
}

function formatAssignedAt(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  const day = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
  const time = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(date);
  return <>{day}<br />{time}</>;
}

function hasActiveCoverage(staff: ClinicStaffAssignment) {
  return staff.substituteCoverages.some((coverage) => coverage.status === 'ACTIVE');
}

export function ClinicStaffView({ data, onAssign }: { data: AuthoritativeClinicStaff; onAssign?: () => void }) {
  const [filter, setFilter] = useState<StaffFilter>('ALL');
  const active = data.staffAssignments.filter((staff) => staff.operationallyReady);
  const disabled = data.staffAssignments.filter((staff) => !staff.operationallyReady);
  const substitutes = data.staffAssignments.filter(hasActiveCoverage);
  const filtered = useMemo(() => {
    if (filter === 'ACTIVE') return active;
    if (filter === 'DISABLED') return disabled;
    if (filter === 'PENDING') return [];
    return data.staffAssignments;
  }, [active, data.staffAssignments, disabled, filter]);
  const filters: Array<{ id: StaffFilter; label: string; count: number }> = [
    { id: 'ALL', label: 'All', count: data.staffAssignments.length },
    { id: 'ACTIVE', label: 'Active', count: active.length },
    { id: 'DISABLED', label: 'Disabled', count: disabled.length },
    { id: 'PENDING', label: 'Pending Invitations', count: 0 },
  ];

  return <section className="clinic-staff-main" aria-labelledby="clinic-staff-title">
    <header className="clinic-staff-intro"><div><h2 id="clinic-staff-title">Staff</h2><p>Manage Secretaries for {data.clinic.name ?? 'this clinic'}.</p></div><button className="clinic-staff-primary-button" type="button" onClick={onAssign}><span aria-hidden="true">♙</span> Assign Secretary</button></header>
    <article className="clinic-staff-list-card">
      <nav className="clinic-staff-filters" aria-label="Staff status filters">{filters.map((item) => <button type="button" key={item.id} className={filter === item.id ? 'is-active' : ''} onClick={() => setFilter(item.id)}>{item.label} ({item.count})</button>)}</nav>
      <div className="clinic-staff-table-head" aria-hidden="true"><span>Secretary</span><span>Clinic</span><span>Status</span><span>Assigned Since</span><span>Role</span><span>Actions</span></div>
      {filtered.length ? filtered.map((staff) => <div className="clinic-staff-table-row" key={staff.practiceStaffId}>
        <div className="clinic-staff-person"><b>{initials(staff.name)}</b><span><strong>{staff.name}</strong><small>{staff.email}</small><small>{staff.mobileNumber}</small></span></div>
        <span>{data.clinic.name ?? '—'}</span>
        <span className={`clinic-staff-status ${staff.operationallyReady ? 'is-active' : 'is-disabled'}`}><i aria-hidden="true" />{staff.operationallyReady ? 'Active' : 'Disabled (at this clinic)'}</span>
        <span className="clinic-staff-assigned-at">{formatAssignedAt(staff.assignedAt)}</span>
        <span className={`clinic-staff-role ${staff.isClinicSecretary ? 'is-clinic' : 'is-substitute'}`}>{staff.isClinicSecretary ? 'Clinic Secretary' : 'Substitute Secretary'} {staff.isClinicSecretary ? <span aria-label="Clinic Secretary">♛</span> : null}</span>
        <span className="clinic-staff-actions"><button type="button" aria-label={`Edit ${staff.name}`}>✎</button><button type="button" aria-label={`More actions for ${staff.name}`}>•••</button></span>
      </div>) : <div className="clinic-staff-empty">{filter === 'PENDING' ? 'No pending invitations.' : `No ${filter.toLowerCase()} Secretaries.`}</div>}
    </article>
    <div className="clinic-staff-access-summary">
      <div className="is-active"><strong>{active.length}</strong><span>Active Clinic Secretary</span><small>Currently assigned to {data.clinic.name ?? 'this clinic'}.</small></div>
      <div className="is-disabled"><strong>{disabled.length}</strong><span>Disabled (at this clinic)</span><small>Assignments ended at this clinic.</small></div>
      <div className="is-pending"><strong>0</strong><span>Pending Invitations</span><small>Invitations sent and awaiting acceptance.</small></div>
      <div className="is-substitute"><strong>{substitutes.length}</strong><span>Substitute Coverage</span><small>Active date-based coverage assignments.</small></div>
    </div>
  </section>;
}

export function AuthoritativeClinicStaffTab({ clinicId }: { clinicId: string }) {
  const [data, setData] = useState<AuthoritativeClinicStaff | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError('');
    void apiRequest<AuthoritativeClinicStaff>(`/practice-location/${encodeURIComponent(clinicId)}/staff`).then((result) => { if (!cancelled) setData(result); }).catch((cause: unknown) => { if (!cancelled) setError(cause instanceof Error ? cause.message : 'Unable to load clinic staff.'); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [clinicId]);
  if (loading) return <div className="ops-workspace-state" role="status">Loading staff assignments…</div>;
  if (error) return <div className="ops-workspace-state is-error" role="alert"><strong>Unable to load clinic staff.</strong><span>{error}</span></div>;
  if (!data) return <div className="ops-workspace-state">No staff data is available.</div>;
  return <ClinicStaffView data={data} />;
}
