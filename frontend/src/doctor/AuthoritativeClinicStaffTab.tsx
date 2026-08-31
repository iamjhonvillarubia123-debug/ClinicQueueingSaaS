import { useEffect, useMemo, useState } from 'react';
import { apiRequest } from '../api/client';
import { StaffAssignmentDrawer, type StaffAssignmentCommand } from './StaffAssignmentDrawer';
import { StaffActionDrawer, type StaffActionCommand } from './StaffActionDrawer';

type StaffFilter = 'ALL' | 'ACTIVE' | 'DISABLED' | 'PENDING';
export type SubstituteCoverage = { id: string; coverageMode: 'ONE_SERVICE_DATE' | 'DATE_RANGE'; fromServiceDate: string; toServiceDate: string; status: 'ACTIVE' | 'CANCELLED' | 'SUPERSEDED'; createdAt: string; endedAt: string | null };
export type ClinicStaffAssignment = { practiceStaffId: string; userId: string; name: string; email: string; mobileNumber: string; assignmentActive: boolean; operationallyReady: boolean; isClinicSecretary: boolean; assignmentType: 'CLINIC_SECRETARY' | 'SUBSTITUTE_SECRETARY'; assignedAt: string; deactivatedAt: string | null; updatedAt: string; authorityBundles: string[]; previousAuthorityBundles: string[]; substituteCoverages: SubstituteCoverage[] };
export type StaffCandidate = { userId: string; name: string; email: string; mobileNumber: string };
export type PendingStaffInvitation = { invitationId: string; name: string; email: string; mobileNumber: string; status: 'PENDING'; invitedAt: string; expiresAt: string };
export type AuthoritativeClinicStaff = { clinic: { id: string; name: string | null }; staffAssignments: ClinicStaffAssignment[]; candidates: StaffCandidate[]; pendingInvitations: PendingStaffInvitation[] };

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

function EditIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 20 4.3-1 10.8-10.8a2.1 2.1 0 0 0-3-3L5.3 16 4 20Z" /><path d="m14.8 6.5 2.8 2.8" /></svg>; }
function TrashIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5" /></svg>; }

export function ClinicStaffView({ data, onAssign, onEdit, onRemove }: { data: AuthoritativeClinicStaff; onAssign?: () => void; onEdit?: (staff: ClinicStaffAssignment) => void; onRemove?: (staff: ClinicStaffAssignment) => void }) {
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
    { id: 'PENDING', label: 'Pending Invitations', count: data.pendingInvitations.length },
  ];

  return <section className="clinic-staff-main" aria-labelledby="clinic-staff-title">
    <header className="clinic-staff-intro"><div><h2 id="clinic-staff-title">Staff</h2><p>Manage Secretaries for {data.clinic.name ?? 'this clinic'}.</p></div><button className="clinic-staff-primary-button" type="button" onClick={onAssign}><span aria-hidden="true">♙</span> Assign Secretary</button></header>
    <article className="clinic-staff-list-card">
      <nav className="clinic-staff-filters" aria-label="Staff status filters">{filters.map((item) => <button type="button" key={item.id} className={filter === item.id ? 'is-active' : ''} onClick={() => setFilter(item.id)}>{item.label} ({item.count})</button>)}</nav>
      <div className="clinic-staff-table-head" aria-hidden="true"><span>Secretary</span><span>Clinic</span><span>Status</span><span>Assigned Since</span><span>Role</span><span>Actions</span></div>
      {filter === 'PENDING' && data.pendingInvitations.length ? data.pendingInvitations.map((invitation) => <div className="clinic-staff-table-row is-invitation" key={invitation.invitationId}>
        <div className="clinic-staff-person"><b>{initials(invitation.name)}</b><span><strong>{invitation.name}</strong><small>{invitation.email}</small><small>{invitation.mobileNumber}</small></span></div><span>{data.clinic.name ?? '—'}</span><span className="clinic-staff-status is-pending"><i aria-hidden="true" />Pending Invitation</span><span className="clinic-staff-assigned-at">{formatAssignedAt(invitation.invitedAt)}</span><span>—</span><span aria-label="No invitation actions">—</span>
      </div>) : filtered.length ? filtered.map((staff) => <div className="clinic-staff-table-row" key={staff.practiceStaffId}>
        <div className="clinic-staff-person"><b>{initials(staff.name)}</b><span><strong>{staff.name}</strong><small>{staff.email}</small><small>{staff.mobileNumber}</small></span></div>
        <span>{data.clinic.name ?? '—'}</span>
        <span className={`clinic-staff-status ${staff.operationallyReady ? 'is-active' : 'is-disabled'}`}><i aria-hidden="true" />{staff.operationallyReady ? 'Active' : 'Disabled (at this clinic)'}</span>
        <span className="clinic-staff-assigned-at">{formatAssignedAt(staff.assignedAt)}</span>
        <span className={`clinic-staff-role ${staff.assignmentType === 'CLINIC_SECRETARY' ? 'is-clinic' : 'is-substitute'}`}>{staff.assignmentType === 'CLINIC_SECRETARY' ? 'Clinic Secretary' : 'Substitute Secretary'} {staff.isClinicSecretary ? <span aria-label="Clinic Secretary">♛</span> : null}</span>
        <span className="clinic-staff-actions"><button type="button" aria-label={`Edit ${staff.name}`} onClick={() => onEdit?.(staff)}><EditIcon /></button><button type="button" aria-label={`Remove ${staff.name}`} onClick={() => onRemove?.(staff)}><TrashIcon /></button></span>
      </div>) : <div className="clinic-staff-empty">{filter === 'PENDING' ? 'No pending invitations.' : `No ${filter.toLowerCase()} Secretaries.`}</div>}
    </article>
    <div className="clinic-staff-access-summary">
      <div className="is-active"><strong>{active.length}</strong><span>Active Clinic Secretary</span><small>Currently assigned to {data.clinic.name ?? 'this clinic'}.</small></div>
      <div className="is-disabled"><strong>{disabled.length}</strong><span>Disabled (at this clinic)</span><small>Assignments ended at this clinic.</small></div>
      <div className="is-pending"><strong>{data.pendingInvitations.length}</strong><span>Pending Invitations</span><small>Invitations sent and awaiting acceptance.</small></div>
      <div className="is-substitute"><strong>{substitutes.length}</strong><span>Substitute Coverage</span><small>Active date-based coverage assignments.</small></div>
    </div>
  </section>;
}

export function AuthoritativeClinicStaffTab({ clinicId }: { clinicId: string }) {
  const [data, setData] = useState<AuthoritativeClinicStaff | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedAction, setSelectedAction] = useState<{ staff: ClinicStaffAssignment; mode: 'EDIT' | 'REMOVE' } | null>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError('');
    void apiRequest<AuthoritativeClinicStaff>(`/practice-location/${encodeURIComponent(clinicId)}/staff`).then((result) => { if (!cancelled) setData(result); }).catch((cause: unknown) => { if (!cancelled) setError(cause instanceof Error ? cause.message : 'Unable to load clinic staff.'); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [clinicId, revision]);

  async function assign(command: StaffAssignmentCommand) {
    setPending(true); setMessage('');
    try {
      if (command.role === 'CLINIC_SECRETARY') {
        const replacing = data?.staffAssignments.some((staff) => staff.isClinicSecretary && staff.assignmentActive);
        await apiRequest(`/practice-staff/regular/${replacing ? 'replace' : 'assign'}`, {
          method: 'POST', headers: { 'Idempotency-Key': crypto.randomUUID() },
          body: { practiceLocationId: clinicId, userId: command.userId, authorityBundles: command.authorityBundles, ...(replacing ? { password: command.password } : {}) },
        });
      } else if (command.role === 'SUBSTITUTE_SECRETARY') {
        await apiRequest('/practice-staff/substitute-coverage/create', {
          method: 'POST', headers: { 'Idempotency-Key': crypto.randomUUID() },
          body: { practiceLocationId: clinicId, userId: command.userId, coverageMode: command.coverageMode, fromServiceDate: command.fromServiceDate, toServiceDate: command.toServiceDate },
        });
      } else await apiRequest('/practice-staff/invitations', { method: 'POST', body: { practiceLocationId: clinicId, firstName: command.firstName, lastName: command.lastName, email: command.email, mobileNumber: command.mobileNumber } });
      setMessage('Assignment successful.');
      setRevision((value) => value + 1);
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : 'Unable to assign this Secretary.');
    } finally { setPending(false); }
  }
  async function handleStaffAction(command: StaffActionCommand) {
    if (!selectedAction) return;
    const staff = selectedAction.staff;
    setPending(true); setMessage('');
    try {
      if (command.type === 'DISABLE' || command.type === 'REMOVE') {
        await apiRequest('/practice-staff/regular/remove', { method: 'POST', headers: { 'Idempotency-Key': crypto.randomUUID() }, body: { practiceLocationId: clinicId, password: command.password } });
      } else if (command.type === 'ACTIVATE_CLINIC') {
        const replacing = data?.staffAssignments.some((item) => item.isClinicSecretary && item.assignmentActive);
        await apiRequest(`/practice-staff/regular/${replacing ? 'replace' : 'assign'}`, { method: 'POST', headers: { 'Idempotency-Key': crypto.randomUUID() }, body: { practiceLocationId: clinicId, userId: staff.userId, authorityBundles: command.authorityBundles, ...(replacing ? { password: command.password } : {}) } });
      } else if (command.type === 'CANCEL_COVERAGE') {
        await apiRequest('/practice-staff/substitute-coverage/cancel', { method: 'POST', headers: { 'Idempotency-Key': crypto.randomUUID() }, body: { coverageId: command.coverageId } });
      } else if (command.type === 'ACTIVATE_SUBSTITUTE') {
        await apiRequest('/practice-staff/substitute-coverage/create', { method: 'POST', headers: { 'Idempotency-Key': crypto.randomUUID() }, body: { practiceLocationId: clinicId, userId: staff.userId, coverageMode: command.coverageMode, fromServiceDate: command.fromServiceDate, toServiceDate: command.toServiceDate } });
      }
      setMessage('Secretary assignment updated successfully.'); setRevision((value) => value + 1); setSelectedAction(null);
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : 'Unable to update this Secretary assignment.'); }
    finally { setPending(false); }
  }
  if (loading) return <div className="ops-workspace-state" role="status">Loading staff assignments…</div>;
  if (error) return <div className="ops-workspace-state is-error" role="alert"><strong>Unable to load clinic staff.</strong><span>{error}</span></div>;
  if (!data) return <div className="ops-workspace-state">No staff data is available.</div>;
  return <div className={`clinic-staff-shell${drawerOpen || selectedAction ? ' has-drawer' : ''}`}><ClinicStaffView data={data} onAssign={() => { setMessage(''); setSelectedAction(null); setDrawerOpen(true); }} onEdit={(staff) => { setMessage(''); setDrawerOpen(false); setSelectedAction({ staff, mode: 'EDIT' }); }} onRemove={(staff) => { setMessage(''); setDrawerOpen(false); setSelectedAction({ staff, mode: 'REMOVE' }); }} />{drawerOpen ? <StaffAssignmentDrawer data={data} pending={pending} message={message} onClose={() => setDrawerOpen(false)} onSubmit={assign} /> : null}{selectedAction ? <StaffActionDrawer staff={selectedAction.staff} mode={selectedAction.mode} replacementRequired={data.staffAssignments.some((item) => item.isClinicSecretary && item.assignmentActive && item.practiceStaffId !== selectedAction.staff.practiceStaffId)} pending={pending} message={message} clinicName={data.clinic.name ?? 'this clinic'} onClose={() => setSelectedAction(null)} onSubmit={handleStaffAction} /> : null}</div>;
}
