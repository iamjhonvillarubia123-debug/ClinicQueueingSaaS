import { useEffect, useMemo, useState } from 'react';
import { apiRequest } from '../api/client';
import {
  PendingInvitationActionDrawer,
  type PendingInvitationActionCommand,
} from './PendingInvitationActionDrawer';
import type { PendingStaffInvitation } from './AuthoritativeClinicStaffTab';

type DirectoryAssignment = {
  practiceStaffId: string;
  name: string;
  email: string;
  mobileNumber: string;
  clinic: { id: string; name: string };
  operationallyReady: boolean;
  isClinicSecretary: boolean;
  assignedAt: string;
  substituteCoverages: Array<{ id: string; status: string }>;
};
type DirectoryInvitation = {
  invitationId: string;
  name: string;
  email: string;
  mobileNumber: string;
  clinic: { id: string; name: string };
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
export type SecretaryDirectory = {
  assignments: DirectoryAssignment[];
  pendingInvitations: DirectoryInvitation[];
};
type Filter = 'ALL' | 'ACTIVE' | 'DISABLED' | 'PENDING';
type InvitationMode = 'VIEW' | 'EDIT' | 'REMOVE';

function initials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
}
function date(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? '—'
    : new Intl.DateTimeFormat('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      }).format(parsed);
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

export function SecretaryDirectoryView({
  data,
  onInvitationView,
  onInvitationEdit,
  onInvitationRemove,
}: {
  data: SecretaryDirectory;
  onInvitationView?: (invitation: DirectoryInvitation) => void;
  onInvitationEdit?: (invitation: DirectoryInvitation) => void;
  onInvitationRemove?: (invitation: DirectoryInvitation) => void;
}) {
  const [filter, setFilter] = useState<Filter>('ALL');
  const active = data.assignments.filter((row) => row.operationallyReady);
  const disabled = data.assignments.filter((row) => !row.operationallyReady);
  const visible = useMemo(
    () =>
      filter === 'ACTIVE'
        ? active
        : filter === 'DISABLED'
          ? disabled
          : filter === 'PENDING'
            ? []
            : data.assignments,
    [active, data.assignments, disabled, filter],
  );
  const tabs: Array<[Filter, string, number]> = [
    ['ALL', 'All', data.assignments.length + data.pendingInvitations.length],
    ['ACTIVE', 'Active', active.length],
    ['DISABLED', 'Disabled', disabled.length],
    ['PENDING', 'Pending Invitations', data.pendingInvitations.length],
  ];
  const invitations =
    filter === 'ALL' || filter === 'PENDING' ? data.pendingInvitations : [];
  return (
    <section className="global-secretaries-page">
      <header>
        <div>
          <h1>Secretaries</h1>
          <p>Manage Secretary assignments across all your clinics.</p>
        </div>
      </header>
      <article className="clinic-staff-list-card">
        <nav
          className="clinic-staff-filters"
          aria-label="Secretary status filters"
        >
          {tabs.map(([id, label, count]) => (
            <button
              key={id}
              type="button"
              className={filter === id ? 'is-active' : ''}
              onClick={() => setFilter(id)}
            >
              {label} ({count})
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
        {invitations.map((row) => (
          <div
            className="clinic-staff-table-row is-invitation"
            key={row.invitationId}
          >
            <div className="clinic-staff-person">
              <b>{initials(row.name)}</b>
              <span>
                <strong>{row.name}</strong>
                <small>{row.email}</small>
                <small>{row.mobileNumber}</small>
              </span>
            </div>
            <span>{row.clinic.name}</span>
            <span className="clinic-staff-status is-pending">
              <i />
              Pending Invitation
            </span>
            <span>—</span>
            <span>
              {row.assignmentType === 'SUBSTITUTE_SECRETARY'
                ? 'Substitute Secretary'
                : 'Clinic Secretary'}
            </span>
            <span className="clinic-staff-actions">
              <button
                type="button"
                aria-label={`Edit ${row.name}`}
                title="Edit planned authority"
                onClick={() => onInvitationEdit?.(row)}
              >
                <EditIcon />
              </button>
              <button
                type="button"
                aria-label={`Remove ${row.name}`}
                title="Remove invitation"
                onClick={() => onInvitationRemove?.(row)}
              >
                <TrashIcon />
              </button>
              <button
                type="button"
                aria-label={`View ${row.name}`}
                title="View invitation"
                onClick={() => onInvitationView?.(row)}
              >
                <EyeIcon />
              </button>
            </span>
          </div>
        ))}
        {filter !== 'PENDING'
          ? visible.map((row) => (
              <div className="clinic-staff-table-row" key={row.practiceStaffId}>
                <div className="clinic-staff-person">
                  <b>{initials(row.name)}</b>
                  <span>
                    <strong>{row.name}</strong>
                    <small>{row.email}</small>
                    <small>{row.mobileNumber}</small>
                  </span>
                </div>
                <span>{row.clinic.name}</span>
                <span
                  className={`clinic-staff-status ${row.operationallyReady ? 'is-active' : 'is-disabled'}`}
                >
                  <i />
                  {row.operationallyReady
                    ? 'Active'
                    : 'Disabled (at this clinic)'}
                </span>
                <span>{date(row.assignedAt)}</span>
                <span
                  className={`clinic-staff-role ${row.isClinicSecretary ? 'is-clinic' : 'is-substitute'}`}
                >
                  {row.isClinicSecretary
                    ? 'Clinic Secretary'
                    : 'Substitute Secretary'}
                </span>
                <span className="clinic-staff-actions">
                  <button
                    type="button"
                    aria-label={`More actions for ${row.name}`}
                  >
                    •••
                  </button>
                </span>
              </div>
            ))
          : null}
      </article>
    </section>
  );
}

export function GlobalSecretariesPage() {
  const [data, setData] = useState<SecretaryDirectory | null>(null);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [selectedInvitation, setSelectedInvitation] = useState<{
    invitation: DirectoryInvitation;
    mode: InvitationMode;
  } | null>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    let cancelled = false;
    setError('');
    void apiRequest<SecretaryDirectory>('/practice-staff/directory')
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((cause: unknown) => {
        if (!cancelled)
          setError(
            cause instanceof Error
              ? cause.message
              : 'Unable to load Secretaries.',
          );
      });
    return () => {
      cancelled = true;
    };
  }, [revision]);

  async function handleInvitationAction(command: PendingInvitationActionCommand) {
    if (!selectedInvitation) return;
    setPending(true);
    setMessage('');
    try {
      await apiRequest(
        `/practice-staff/invitations/${encodeURIComponent(selectedInvitation.invitation.invitationId)}`,
        command.type === 'REMOVE'
          ? { method: 'DELETE' }
          : { method: 'PATCH', body: command },
      );
      setMessage(
        command.type === 'REMOVE'
          ? 'Pending invitation cancelled successfully.'
          : 'Pending invitation updated successfully.',
      );
      setRevision((value) => value + 1);
      if (command.type === 'REMOVE') setSelectedInvitation(null);
    } catch (cause) {
      setMessage(
        cause instanceof Error
          ? cause.message
          : 'Unable to update this pending invitation.',
      );
    } finally {
      setPending(false);
    }
  }

  if (error)
    return (
      <div className="ops-workspace-state is-error" role="alert">
        {error}
      </div>
    );
  if (!data)
    return (
      <div className="ops-workspace-state" role="status">
        Loading Secretaries…
      </div>
    );

  const selectedAsClinicInvitation = selectedInvitation
    ? ({
        invitationId: selectedInvitation.invitation.invitationId,
        name: selectedInvitation.invitation.name,
        email: selectedInvitation.invitation.email,
        mobileNumber: selectedInvitation.invitation.mobileNumber,
        status: 'PENDING',
        assignmentType: selectedInvitation.invitation.assignmentType,
        authorityBundles: selectedInvitation.invitation.authorityBundles,
        requestedCancelClinicDay:
          selectedInvitation.invitation.requestedCancelClinicDay,
        coverageMode: selectedInvitation.invitation.coverageMode,
        fromServiceDate: selectedInvitation.invitation.fromServiceDate,
        toServiceDate: selectedInvitation.invitation.toServiceDate,
        invitedAt: selectedInvitation.invitation.invitedAt,
        expiresAt: selectedInvitation.invitation.expiresAt,
      } satisfies PendingStaffInvitation)
    : null;

  return (
    <>
      <SecretaryDirectoryView
        data={data}
        onInvitationView={(invitation) => {
          setMessage('');
          setSelectedInvitation({ invitation, mode: 'VIEW' });
        }}
        onInvitationEdit={(invitation) => {
          setMessage('');
          setSelectedInvitation({ invitation, mode: 'EDIT' });
        }}
        onInvitationRemove={(invitation) => {
          setMessage('');
          setSelectedInvitation({ invitation, mode: 'REMOVE' });
        }}
      />
      {selectedInvitation && selectedAsClinicInvitation ? (
        <PendingInvitationActionDrawer
          invitation={selectedAsClinicInvitation}
          mode={selectedInvitation.mode}
          clinicName={selectedInvitation.invitation.clinic.name}
          pending={pending}
          message={message}
          onClose={() => {
            setSelectedInvitation(null);
            setMessage('');
          }}
          onSubmit={handleInvitationAction}
        />
      ) : null}
    </>
  );
}
