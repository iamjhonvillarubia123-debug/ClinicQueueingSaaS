import { useEffect, useMemo, useState } from 'react';
import { apiRequest } from '../api/client';

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
  assignmentType?: 'CLINIC_SECRETARY' | 'SUBSTITUTE_SECRETARY';
  invitedAt: string;
};
export type SecretaryDirectory = {
  assignments: DirectoryAssignment[];
  pendingInvitations: DirectoryInvitation[];
};
type Filter = 'ALL' | 'ACTIVE' | 'DISABLED' | 'PENDING';

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

export function SecretaryDirectoryView({ data }: { data: SecretaryDirectory }) {
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
          <div className="clinic-staff-table-row" key={row.invitationId}>
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
              <button type="button" aria-label={`More actions for ${row.name}`}>
                •••
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
  useEffect(() => {
    void apiRequest<SecretaryDirectory>('/practice-staff/directory')
      .then(setData)
      .catch((cause: unknown) =>
        setError(
          cause instanceof Error
            ? cause.message
            : 'Unable to load Secretaries.',
        ),
      );
  }, []);
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
  return <SecretaryDirectoryView data={data} />;
}
