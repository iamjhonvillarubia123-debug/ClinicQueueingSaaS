import { useEffect, useMemo, useState } from 'react';
import { apiRequest } from '../api/client';
import {
  StaffAssignmentDrawer,
  type StaffAssignmentCommand,
} from './StaffAssignmentDrawer';
import {
  StaffActionDrawer,
  type StaffActionCommand,
  type StaffRemovalImpact,
} from './StaffActionDrawer';
import {
  PendingInvitationActionDrawer,
  type PendingInvitationActionCommand,
} from './PendingInvitationActionDrawer';

type StaffFilter = 'ALL' | 'ACTIVE' | 'DISABLED' | 'PENDING';
export type SubstituteCoverage = {
  id: string;
  coverageMode: 'ONE_SERVICE_DATE' | 'DATE_RANGE';
  fromServiceDate: string;
  toServiceDate: string;
  status: 'ACTIVE' | 'CANCELLED' | 'SUPERSEDED';
  createdAt: string;
  endedAt: string | null;
};
export type ClinicStaffAssignment = {
  practiceStaffId: string;
  userId: string;
  name: string;
  email: string;
  mobileNumber: string;
  assignmentActive: boolean;
  operationallyReady: boolean;
  isClinicSecretary: boolean;
  assignmentType: 'CLINIC_SECRETARY' | 'SUBSTITUTE_SECRETARY';
  assignedAt: string;
  deactivatedAt: string | null;
  updatedAt: string;
  authorityBundles: string[];
  previousAuthorityBundles: string[];
  substituteCoverages: SubstituteCoverage[];
};
export type StaffCandidate = {
  userId: string;
  name: string;
  email: string;
  mobileNumber: string;
};
export type PendingStaffInvitation = {
  invitationId: string;
  name: string;
  email: string;
  mobileNumber: string;
  status: 'PENDING';
  assignmentType: 'CLINIC_SECRETARY' | 'SUBSTITUTE_SECRETARY';
  authorityBundles: string[];
  requestedCancelClinicDay?: boolean;
  coverageMode: 'ONE_SERVICE_DATE' | 'DATE_RANGE' | null;
  fromServiceDate: string | null;
  toServiceDate: string | null;
  invitedAt: string;
  expiresAt: string;
};
export type AuthoritativeClinicStaff = {
  clinic: { id: string; name: string | null };
  staffAssignments: ClinicStaffAssignment[];
  candidates: StaffCandidate[];
  pendingInvitations: PendingStaffInvitation[];
};

function initials(name: string) {
  return (
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? '')
      .join('') || '?'
  );
}

function formatAssignedAt(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  const day = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date);
  const time = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
  return (
    <>
      {day}
      <br />
      {time}
    </>
  );
}

function hasActiveCoverage(staff: ClinicStaffAssignment) {
  return staff.substituteCoverages.some(
    (coverage) => coverage.status === 'ACTIVE',
  );
}

function EditIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m4 20 4.3-1 10.8-10.8a2.1 2.1 0 0 0-3-3L5.3 16 4 20Z" />
      <path d="m14.8 6.5 2.8 2.8" />
    </svg>
  );
}
function EyeIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" />
      <circle cx="12" cy="12" r="2.75" />
    </svg>
  );
}
function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5" />
    </svg>
  );
}

export function ClinicStaffView({
  data,
  onAssign,
  onView,
  onEdit,
  onRemove,
  onInvitationView,
  onInvitationEdit,
  onInvitationRemove,
}: {
  data: AuthoritativeClinicStaff;
  onAssign?: () => void;
  onView?: (staff: ClinicStaffAssignment) => void;
  onEdit?: (staff: ClinicStaffAssignment) => void;
  onRemove?: (staff: ClinicStaffAssignment) => void;
  onInvitationView?: (invitation: PendingStaffInvitation) => void;
  onInvitationEdit?: (invitation: PendingStaffInvitation) => void;
  onInvitationRemove?: (invitation: PendingStaffInvitation) => void;
}) {
  const [filter, setFilter] = useState<StaffFilter>('ALL');
  const active = data.staffAssignments.filter(
    (staff) => staff.operationallyReady,
  );
  const disabled = data.staffAssignments.filter(
    (staff) => !staff.operationallyReady,
  );
  const substitutes = data.staffAssignments.filter(hasActiveCoverage);
  const filtered = useMemo(() => {
    if (filter === 'ACTIVE') return active;
    if (filter === 'DISABLED') return disabled;
    if (filter === 'PENDING') return [];
    return data.staffAssignments;
  }, [active, data.staffAssignments, disabled, filter]);
  const filters: Array<{ id: StaffFilter; label: string; count: number }> = [
    {
      id: 'ALL',
      label: 'All',
      count: data.staffAssignments.length + data.pendingInvitations.length,
    },
    { id: 'ACTIVE', label: 'Active', count: active.length },
    { id: 'DISABLED', label: 'Disabled', count: disabled.length },
    {
      id: 'PENDING',
      label: 'Pending Invitations',
      count: data.pendingInvitations.length,
    },
  ];

  return (
    <section className="clinic-staff-main" aria-labelledby="clinic-staff-title">
      <header className="clinic-staff-intro">
        <div>
          <h2 id="clinic-staff-title">Staff</h2>
          <p>Manage Secretaries for {data.clinic.name ?? 'this clinic'}.</p>
        </div>
        <button
          className="clinic-staff-primary-button"
          type="button"
          onClick={onAssign}
        >
          <span aria-hidden="true">♙</span> Assign Secretary
        </button>
      </header>
      <article className="clinic-staff-list-card">
        <nav className="clinic-staff-filters" aria-label="Staff status filters">
          {filters.map((item) => (
            <button
              type="button"
              key={item.id}
              className={filter === item.id ? 'is-active' : ''}
              onClick={() => setFilter(item.id)}
            >
              {item.label} ({item.count})
            </button>
          ))}
        </nav>
        <div className="clinic-staff-table-head" aria-hidden="true">
          <span>Secretary</span>
          <span>Clinic</span>
          <span>Status</span>
          <span>Assigned Since</span>
          <span>Role</span>
          <span>Actions</span>
        </div>
        {filter === 'ALL' || filter === 'PENDING'
          ? data.pendingInvitations.map((invitation) => (
              <div
                className="clinic-staff-table-row is-invitation"
                key={invitation.invitationId}
              >
                <div className="clinic-staff-person">
                  <b>{initials(invitation.name)}</b>
                  <span>
                    <strong>{invitation.name}</strong>
                    <small>{invitation.email}</small>
                    <small>{invitation.mobileNumber}</small>
                  </span>
                </div>
                <span>{data.clinic.name ?? '—'}</span>
                <span className="clinic-staff-status is-pending">
                  <i aria-hidden="true" />
                  Pending Invitation
                </span>
                <span className="clinic-staff-assigned-at">—</span>
                <span
                  className={`clinic-staff-role ${invitation.assignmentType === 'CLINIC_SECRETARY' ? 'is-clinic' : 'is-substitute'}`}
                >
                  {invitation.assignmentType === 'CLINIC_SECRETARY'
                    ? 'Clinic Secretary'
                    : 'Substitute Secretary'}
                </span>
                <span className="clinic-staff-actions">
                  <button
                    type="button"
                    aria-label={`Edit ${invitation.name}`}
                    title="Edit planned authority"
                    onClick={() => onInvitationEdit?.(invitation)}
                  >
                    <EditIcon />
                  </button>
                  <button
                    type="button"
                    aria-label={`Remove ${invitation.name}`}
                    title="Remove invitation"
                    onClick={() => onInvitationRemove?.(invitation)}
                  >
                    <TrashIcon />
                  </button>
                  <button
                    type="button"
                    aria-label={`View ${invitation.name}`}
                    title="View invitation"
                    onClick={() => onInvitationView?.(invitation)}
                  >
                    <EyeIcon />
                  </button>
                </span>
              </div>
            ))
          : null}
        {filter !== 'PENDING'
          ? filtered.map((staff) => (
              <div
                className="clinic-staff-table-row"
                key={staff.practiceStaffId}
              >
                <div className="clinic-staff-person">
                  <b>{initials(staff.name)}</b>
                  <span>
                    <strong>{staff.name}</strong>
                    <small>{staff.email}</small>
                    <small>{staff.mobileNumber}</small>
                  </span>
                </div>
                <span>{data.clinic.name ?? '—'}</span>
                <span
                  className={`clinic-staff-status ${staff.operationallyReady ? 'is-active' : 'is-disabled'}`}
                >
                  <i aria-hidden="true" />
                  {staff.operationallyReady
                    ? 'Active'
                    : 'Disabled (at this clinic)'}
                </span>
                <span className="clinic-staff-assigned-at">
                  {formatAssignedAt(staff.assignedAt)}
                </span>
                <span
                  className={`clinic-staff-role ${staff.assignmentType === 'CLINIC_SECRETARY' ? 'is-clinic' : 'is-substitute'}`}
                >
                  {staff.assignmentType === 'CLINIC_SECRETARY'
                    ? 'Clinic Secretary'
                    : 'Substitute Secretary'}{' '}
                  {staff.isClinicSecretary ? (
                    <span aria-label="Clinic Secretary">♛</span>
                  ) : null}
                </span>
                <span className="clinic-staff-actions">
                  <button
                    type="button"
                    aria-label={`Edit ${staff.name}`}
                    title="Edit assignment"
                    onClick={() => onEdit?.(staff)}
                  >
                    <EditIcon />
                  </button>
                  <button
                    type="button"
                    aria-label={`Remove ${staff.name}`}
                    title="Remove assignment"
                    onClick={() => onRemove?.(staff)}
                  >
                    <TrashIcon />
                  </button>
                  <button
                    type="button"
                    aria-label={`View ${staff.name}`}
                    title="View profile"
                    onClick={() => onView?.(staff)}
                  >
                    <EyeIcon />
                  </button>
                </span>
              </div>
            ))
          : null}
        {(filter === 'PENDING' && data.pendingInvitations.length === 0) ||
        (filter !== 'PENDING' &&
          filtered.length === 0 &&
          (filter !== 'ALL' || data.pendingInvitations.length === 0)) ? (
          <div className="clinic-staff-empty">
            {filter === 'PENDING'
              ? 'No pending invitations.'
              : `No ${filter.toLowerCase()} Secretaries.`}
          </div>
        ) : null}
      </article>
      <div className="clinic-staff-access-summary">
        <div className="is-active">
          <strong>{active.length}</strong>
          <span>Active Clinic Secretary</span>
          <small>
            Currently assigned to {data.clinic.name ?? 'this clinic'}.
          </small>
        </div>
        <div className="is-disabled">
          <strong>{disabled.length}</strong>
          <span>Disabled (at this clinic)</span>
          <small>Assignments ended at this clinic.</small>
        </div>
        <div className="is-pending">
          <strong>{data.pendingInvitations.length}</strong>
          <span>Pending Invitations</span>
          <small>Invitations sent and awaiting acceptance.</small>
        </div>
        <div className="is-substitute">
          <strong>{substitutes.length}</strong>
          <span>Substitute Coverage</span>
          <small>Active date-based coverage assignments.</small>
        </div>
      </div>
    </section>
  );
}

export function AuthoritativeClinicStaffTab({
  clinicId,
}: {
  clinicId: string;
}) {
  const [data, setData] = useState<AuthoritativeClinicStaff | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedAction, setSelectedAction] = useState<{
    staff: ClinicStaffAssignment;
    mode: 'VIEW' | 'EDIT' | 'REMOVE';
  } | null>(null);
  const [selectedInvitationAction, setSelectedInvitationAction] = useState<{
    invitation: PendingStaffInvitation;
    mode: 'VIEW' | 'EDIT' | 'REMOVE';
  } | null>(null);
  const [pending, setPending] = useState(false);
  const [removalImpact, setRemovalImpact] = useState<StaffRemovalImpact | null>(
    null,
  );
  const [impactLoading, setImpactLoading] = useState(false);
  const [impactError, setImpactError] = useState('');
  const [message, setMessage] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    void apiRequest<AuthoritativeClinicStaff>(
      `/practice-location/${encodeURIComponent(clinicId)}/staff`,
    )
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((cause: unknown) => {
        if (!cancelled)
          setError(
            cause instanceof Error
              ? cause.message
              : 'Unable to load clinic staff.',
          );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [clinicId, revision]);
  useEffect(() => {
    if (!selectedAction || selectedAction.mode !== 'REMOVE') {
      setRemovalImpact(null);
      setImpactLoading(false);
      setImpactError('');
      return;
    }
    let cancelled = false;
    setImpactLoading(true);
    setImpactError('');
    setRemovalImpact(null);
    void apiRequest<StaffRemovalImpact>(
      `/practice-staff/relationships/${encodeURIComponent(selectedAction.staff.practiceStaffId)}/removal-impact`,
    )
      .then((result) => {
        if (!cancelled) setRemovalImpact(result);
      })
      .catch((cause: unknown) => {
        if (!cancelled)
          setImpactError(
            cause instanceof Error
              ? cause.message
              : 'Unable to check removal consequences.',
          );
      })
      .finally(() => {
        if (!cancelled) setImpactLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedAction]);

  async function assign(command: StaffAssignmentCommand) {
    setPending(true);
    setMessage('');
    try {
      const assignmentType =
        command.role === 'INVITE_NEW' ? command.assignmentType : command.role;
      const roleConfiguration =
        'authorityBundles' in command
          ? {
              authorityBundles: command.authorityBundles,
              requestedCancelClinicDay: command.requestedCancelClinicDay,
              password: command.password,
            }
          : {
              coverageMode: command.coverageMode,
              fromServiceDate: command.fromServiceDate,
              toServiceDate: command.toServiceDate,
            };
      await apiRequest('/practice-staff/invitations', {
        method: 'POST',
        body: {
          practiceLocationId: clinicId,
          firstName: command.firstName,
          lastName: command.lastName,
          email: command.email,
          mobileNumber: command.mobileNumber,
          assignmentType,
          ...roleConfiguration,
        },
      });
      setMessage('Invitation sent successfully.');
      setRevision((value) => value + 1);
    } catch (cause) {
      setMessage(
        cause instanceof Error
          ? cause.message
          : 'Unable to assign this Secretary.',
      );
    } finally {
      setPending(false);
    }
  }
  async function handleStaffAction(command: StaffActionCommand) {
    if (!selectedAction) return;
    const staff = selectedAction.staff;
    setPending(true);
    setMessage('');
    try {
      if (command.type === 'REMOVE') {
        await apiRequest(
          `/practice-staff/relationships/${encodeURIComponent(staff.practiceStaffId)}`,
          { method: 'DELETE', body: { password: command.password } },
        );
      } else if (command.type === 'DISABLE') {
        await apiRequest('/practice-staff/regular/remove', {
          method: 'POST',
          headers: { 'Idempotency-Key': crypto.randomUUID() },
          body: { practiceLocationId: clinicId },
        });
      } else if (command.type === 'UPDATE_CLINIC_AUTHORITY') {
        await apiRequest(
          `/practice-staff/regular/${encodeURIComponent(staff.practiceStaffId)}/authority`,
          {
            method: 'PATCH',
            body: { authorityBundles: command.authorityBundles },
          },
        );
      } else if (command.type === 'ACTIVATE_CLINIC') {
        const replacing = data?.staffAssignments.some(
          (item) => item.isClinicSecretary && item.assignmentActive,
        );
        await apiRequest(
          `/practice-staff/regular/${replacing ? 'replace' : 'assign'}`,
          {
            method: 'POST',
            headers: { 'Idempotency-Key': crypto.randomUUID() },
            body: {
              practiceLocationId: clinicId,
              userId: staff.userId,
              authorityBundles: command.authorityBundles,
              ...(replacing ? { password: command.password } : {}),
            },
          },
        );
      } else if (command.type === 'CANCEL_COVERAGE') {
        await apiRequest('/practice-staff/substitute-coverage/cancel', {
          method: 'POST',
          headers: { 'Idempotency-Key': crypto.randomUUID() },
          body: { coverageId: command.coverageId },
        });
      } else if (command.type === 'ACTIVATE_SUBSTITUTE') {
        await apiRequest('/practice-staff/substitute-coverage/create', {
          method: 'POST',
          headers: { 'Idempotency-Key': crypto.randomUUID() },
          body: {
            practiceLocationId: clinicId,
            userId: staff.userId,
            coverageMode: command.coverageMode,
            fromServiceDate: command.fromServiceDate,
            toServiceDate: command.toServiceDate,
          },
        });
      }
      setMessage(
        command.type === 'REMOVE'
          ? 'Secretary connection removed successfully.'
          : 'Secretary assignment updated successfully.',
      );
      setRevision((value) => value + 1);
      setSelectedAction(null);
    } catch (cause) {
      setMessage(
        cause instanceof Error
          ? cause.message
          : 'Unable to update this Secretary assignment.',
      );
    } finally {
      setPending(false);
    }
  }
  async function handleInvitationAction(
    command: PendingInvitationActionCommand,
  ) {
    if (!selectedInvitationAction) return;
    setPending(true);
    setMessage('');
    try {
      await apiRequest(
        `/practice-staff/invitations/${encodeURIComponent(selectedInvitationAction.invitation.invitationId)}`,
        command.type === 'REMOVE'
          ? { method: 'DELETE' }
          : { method: 'PATCH', body: command },
      );
      setMessage(
        command.type === 'REMOVE'
          ? 'Pending invitation cancelled and removed.'
          : 'Planned authority updated.',
      );
      setRevision((value) => value + 1);
      setSelectedInvitationAction(null);
    } catch (cause) {
      setMessage(
        cause instanceof Error
          ? cause.message
          : 'Unable to update this invitation.',
      );
    } finally {
      setPending(false);
    }
  }
  if (loading)
    return (
      <div className="ops-workspace-state" role="status">
        Loading staff assignments…
      </div>
    );
  if (error)
    return (
      <div className="ops-workspace-state is-error" role="alert">
        <strong>Unable to load clinic staff.</strong>
        <span>{error}</span>
      </div>
    );
  if (!data)
    return (
      <div className="ops-workspace-state">No staff data is available.</div>
    );
  return (
    <div
      className={`clinic-staff-shell${drawerOpen || selectedAction || selectedInvitationAction ? ' has-drawer' : ''}`}
    >
      <ClinicStaffView
        data={data}
        onAssign={() => {
          setMessage('');
          setSelectedAction(null);
          setDrawerOpen(true);
        }}
        onView={(staff) => {
          setMessage('');
          setDrawerOpen(false);
          setSelectedAction({ staff, mode: 'VIEW' });
        }}
        onEdit={(staff) => {
          setMessage('');
          setDrawerOpen(false);
          setSelectedAction({ staff, mode: 'EDIT' });
        }}
        onRemove={(staff) => {
          setMessage('');
          setDrawerOpen(false);
          setSelectedAction({ staff, mode: 'REMOVE' });
        }}
        onInvitationView={(invitation) => {
          setMessage('');
          setDrawerOpen(false);
          setSelectedAction(null);
          setSelectedInvitationAction({ invitation, mode: 'VIEW' });
        }}
        onInvitationEdit={(invitation) => {
          setMessage('');
          setDrawerOpen(false);
          setSelectedAction(null);
          setSelectedInvitationAction({ invitation, mode: 'EDIT' });
        }}
        onInvitationRemove={(invitation) => {
          setMessage('');
          setDrawerOpen(false);
          setSelectedAction(null);
          setSelectedInvitationAction({ invitation, mode: 'REMOVE' });
        }}
      />
      {drawerOpen ? (
        <StaffAssignmentDrawer
          data={data}
          pending={pending}
          message={message}
          onClose={() => setDrawerOpen(false)}
          onSubmit={assign}
        />
      ) : null}
      {selectedAction ? (
        <StaffActionDrawer
          staff={selectedAction.staff}
          mode={selectedAction.mode}
          replacementRequired={data.staffAssignments.some(
            (item) =>
              item.isClinicSecretary &&
              item.assignmentActive &&
              item.practiceStaffId !== selectedAction.staff.practiceStaffId,
          )}
          pending={pending}
          message={message}
          removalImpact={removalImpact}
          impactLoading={impactLoading}
          impactError={impactError}
          clinicName={data.clinic.name ?? 'this clinic'}
          onClose={() => setSelectedAction(null)}
          onSubmit={handleStaffAction}
        />
      ) : null}
      {selectedInvitationAction ? (
        <PendingInvitationActionDrawer
          invitation={selectedInvitationAction.invitation}
          mode={selectedInvitationAction.mode}
          clinicName={data.clinic.name ?? 'this clinic'}
          pending={pending}
          message={message}
          onClose={() => setSelectedInvitationAction(null)}
          onSubmit={handleInvitationAction}
        />
      ) : null}
    </div>
  );
}
