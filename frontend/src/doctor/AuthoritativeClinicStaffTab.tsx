import { useEffect, useMemo, useState } from 'react';
import { apiRequest } from '../api/client';
import { ServiceDateControl, formatServiceDate } from './ServiceDateControl';

export type ClinicStaffMember = {
  practiceStaffId: string;
  userId: string;
  name: string;
  email: string;
  staffRole: string;
  assignmentActive: boolean;
  userRole: string;
  accountStatus: string;
  operationallyReady: boolean;
  assignedAt: string;
  updatedAt: string;
};

export type ClinicStaffAssignment = ClinicStaffMember & {
  isRegular: boolean;
  isOperating: boolean;
};

export type AuthoritativeClinicStaff = {
  clinic: { id: string; name: string | null };
  serviceDate: string;
  regularSecretary: ClinicStaffMember | null;
  operatingSecretary: ClinicStaffMember | null;
  clinicDay: {
    id: string;
    status: string;
    operatingPracticeStaffId: string | null;
  } | null;
  staffAssignments: ClinicStaffAssignment[];
};

type DaySecretaryAction =
  | { type: 'ASSIGN'; userId: string }
  | { type: 'REPLACE'; clinicDayId: string; userId: string }
  | { type: 'CLEAR'; clinicDayId: string };

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return parts
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

function formatAssignedAt(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

function StaffStatus({ staff }: { staff: ClinicStaffAssignment }) {
  const active = staff.assignmentActive && staff.accountStatus === 'ACTIVE';
  return (
    <span className={`clinic-staff-status ${active ? 'is-active' : 'is-inactive'}`}>
      <i aria-hidden="true" />
      {active ? 'Active' : 'Inactive'}
    </span>
  );
}

function SecretaryForDayPanel({
  data,
  serviceDate,
  onServiceDateChange,
  onOpenDrawer,
}: {
  data: AuthoritativeClinicStaff;
  serviceDate: string;
  onServiceDateChange: (value: string) => void;
  onOpenDrawer: () => void;
}) {
  const terminal =
    data.clinicDay?.status === 'CLOSED' || data.clinicDay?.status === 'CANCELLED';
  return (
    <section className="clinic-day-secretary-panel" aria-labelledby="day-secretary-title">
      <div className="clinic-day-secretary-date">
        <ServiceDateControl
          compact
          value={serviceDate}
          onChange={onServiceDateChange}
        />
      </div>
      <div className="clinic-day-secretary-copy">
        <small id="day-secretary-title">Secretary for the Day</small>
        <strong>{data.operatingSecretary?.name ?? 'Doctor handling this clinic day'}</strong>
        <span>
          {data.operatingSecretary
            ? `Assigned for ${formatServiceDate(serviceDate, true)}`
            : 'No Secretary has day-specific clinic authority.'}
        </span>
      </div>
      <div className="clinic-day-secretary-context">
        <small>Clinic Secretary</small>
        <strong>{data.regularSecretary?.name ?? 'Not assigned'}</strong>
        <span>Regular clinic assignment</span>
      </div>
      <button
        type="button"
        className="clinic-staff-primary-button"
        onClick={onOpenDrawer}
        disabled={terminal}
      >
        {data.operatingSecretary
          ? 'Change Secretary for the Day'
          : 'Assign Secretary for the Day'}
      </button>
    </section>
  );
}

function DaySecretaryDrawer({
  data,
  serviceDate,
  actionPending,
  actionMessage,
  onClose,
  onAction,
}: {
  data: AuthoritativeClinicStaff;
  serviceDate: string;
  actionPending: boolean;
  actionMessage: string;
  onClose: () => void;
  onAction: (action: DaySecretaryAction) => void | Promise<void>;
}) {
  const candidates = useMemo(
    () =>
      data.staffAssignments.filter(
        (staff) => staff.operationallyReady && !staff.isOperating,
      ),
    [data.staffAssignments],
  );
  const [selectedUserId, setSelectedUserId] = useState(
    candidates[0]?.userId ?? '',
  );
  const status = data.clinicDay?.status ?? 'NOT_STARTED';
  const terminal = status === 'CLOSED' || status === 'CANCELLED';
  const started = status === 'STARTED';

  useEffect(() => {
    if (!candidates.some((staff) => staff.userId === selectedUserId)) {
      setSelectedUserId(candidates[0]?.userId ?? '');
    }
  }, [candidates, selectedUserId]);

  function submit() {
    if (!selectedUserId || terminal) return;
    if (data.operatingSecretary && data.clinicDay && started) {
      void onAction({
        type: 'REPLACE',
        clinicDayId: data.clinicDay.id,
        userId: selectedUserId,
      });
      return;
    }
    if (!data.operatingSecretary) {
      void onAction({ type: 'ASSIGN', userId: selectedUserId });
    }
  }

  return (
    <aside className="clinic-day-secretary-drawer" aria-label="Secretary for the Day drawer">
      <button
        className="clinic-day-secretary-close"
        type="button"
        onClick={onClose}
        aria-label="Close Secretary for the Day drawer"
      >
        ×
      </button>
      <header>
        <span className="clinic-drawer-step">1</span>
        <div>
          <h2>Secretary for the Day</h2>
          <p>{formatServiceDate(serviceDate, true)}</p>
        </div>
      </header>

      <div className="clinic-day-secretary-explainer">
        <strong>Day-specific clinic authority</strong>
        <p>
          Choose who will handle live clinic operations for this service date.
          This does not change the regular Clinic Secretary assignment.
        </p>
      </div>

      <section className="clinic-day-secretary-current">
        <small>Currently assigned for this day</small>
        <strong>{data.operatingSecretary?.name ?? 'No Secretary assigned'}</strong>
        <span>
          {data.operatingSecretary?.email ?? 'The Doctor is handling this clinic day.'}
        </span>
      </section>

      {terminal ? (
        <div className="clinic-day-secretary-note">
          This Clinic Day is {status.replaceAll('_', ' ').toLowerCase()} and can no longer
          change its day Secretary.
        </div>
      ) : null}

      {!terminal && data.operatingSecretary && !started ? (
        <div className="clinic-day-secretary-note">
          Before the clinic starts, remove the current day assignment before choosing a
          different Secretary. Once the clinic has started, this becomes a direct handoff.
        </div>
      ) : null}

      {!terminal && (!data.operatingSecretary || started) ? (
        <section className="clinic-day-secretary-options">
          <h3>
            {data.operatingSecretary ? 'Choose the new Secretary' : 'Choose a Secretary'}
          </h3>
          {candidates.length ? (
            candidates.map((staff) => (
              <button
                type="button"
                key={staff.practiceStaffId}
                className={`clinic-day-secretary-option${
                  selectedUserId === staff.userId ? ' is-selected' : ''
                }`}
                onClick={() => setSelectedUserId(staff.userId)}
              >
                <b>{initials(staff.name)}</b>
                <span>
                  <strong>{staff.name}</strong>
                  <small>{staff.email}</small>
                  {staff.isRegular ? <em>Clinic Secretary</em> : null}
                </span>
                <i aria-hidden="true" />
              </button>
            ))
          ) : (
            <p className="clinic-day-secretary-empty">
              No other operationally-ready Secretary is assigned to this clinic.
            </p>
          )}
          <button
            type="button"
            className="clinic-staff-primary-button is-full"
            disabled={actionPending || !selectedUserId || candidates.length === 0}
            onClick={submit}
          >
            {actionPending
              ? 'Updating…'
              : data.operatingSecretary
                ? 'Change Secretary for the Day'
                : 'Assign Secretary for the Day'}
          </button>
        </section>
      ) : null}

      {!terminal && data.operatingSecretary && data.clinicDay ? (
        <button
          type="button"
          className="clinic-staff-secondary-button is-full"
          disabled={actionPending}
          onClick={() =>
            void onAction({ type: 'CLEAR', clinicDayId: data.clinicDay!.id })
          }
        >
          Remove Secretary for the Day
        </button>
      ) : null}

      {actionMessage ? (
        <div className="clinic-day-secretary-message" role="status">
          {actionMessage}
        </div>
      ) : null}
    </aside>
  );
}

export function ClinicStaffView({
  data,
  serviceDate,
  onServiceDateChange,
  onOperatingSecretaryAction,
  actionPending = false,
  actionMessage = '',
}: {
  data: AuthoritativeClinicStaff;
  serviceDate: string;
  onServiceDateChange: (value: string) => void;
  onOperatingSecretaryAction?: (
    action: DaySecretaryAction,
  ) => void | Promise<void>;
  actionPending?: boolean;
  actionMessage?: string;
}) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [search, setSearch] = useState('');
  const matchingStaff = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return data.staffAssignments;
    return data.staffAssignments.filter((staff) =>
      `${staff.name} ${staff.email}`.toLowerCase().includes(query),
    );
  }, [data.staffAssignments, search]);
  const activeCount = data.staffAssignments.filter(
    (staff) => staff.assignmentActive && staff.accountStatus === 'ACTIVE',
  ).length;
  const inactiveCount = data.staffAssignments.length - activeCount;

  return (
    <div className={`clinic-staff-shell${drawerOpen ? ' has-drawer' : ''}`}>
      <main className="clinic-staff-main">
        <div className="clinic-staff-intro">
          <div>
            <h2>Staff</h2>
            <p>Manage the Secretaries assigned to {data.clinic.name ?? 'this clinic'}.</p>
          </div>
        </div>

        <SecretaryForDayPanel
          data={data}
          serviceDate={serviceDate}
          onServiceDateChange={onServiceDateChange}
          onOpenDrawer={() => setDrawerOpen(true)}
        />

        <article className="clinic-staff-list-card">
          <div className="clinic-staff-list-toolbar">
            <div>
              <strong>Clinic Secretaries ({data.staffAssignments.length})</strong>
              <span>Regular clinic assignments and access status</span>
            </div>
            <input
              type="search"
              placeholder="Search secretary by name or email…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              aria-label="Search clinic secretaries"
            />
          </div>

          <div className="clinic-staff-table-head" aria-hidden="true">
            <span>Secretary</span>
            <span>Role at this Clinic</span>
            <span>Status</span>
            <span>Assigned Since</span>
          </div>

          {matchingStaff.length ? (
            matchingStaff.map((staff) => (
              <div className="clinic-staff-table-row" key={staff.practiceStaffId}>
                <div className="clinic-staff-person">
                  <b>{initials(staff.name)}</b>
                  <span>
                    <strong>{staff.name}</strong>
                    <small>{staff.email}</small>
                  </span>
                </div>
                <div className="clinic-staff-role">
                  <span>{staff.isRegular ? 'Clinic Secretary' : 'Assigned Secretary'}</span>
                  {staff.isOperating ? <em>Secretary for this day</em> : null}
                </div>
                <StaffStatus staff={staff} />
                <span className="clinic-staff-assigned-at">
                  {formatAssignedAt(staff.assignedAt)}
                </span>
              </div>
            ))
          ) : (
            <div className="clinic-staff-empty">No Secretaries match this search.</div>
          )}

          <div className="clinic-staff-access-summary">
            <div className="is-active">
              <strong>{activeCount}</strong>
              <span>Active Secretaries</span>
              <small>Can access this clinic according to their assigned role</small>
            </div>
            <div>
              <strong>{inactiveCount}</strong>
              <span>Inactive Secretaries</span>
              <small>Assignment or account access is inactive</small>
            </div>
            <div className="is-day">
              <strong>{data.operatingSecretary ? '1' : '0'}</strong>
              <span>Secretary for the Day</span>
              <small>{data.operatingSecretary?.name ?? 'Doctor handling this clinic day'}</small>
            </div>
          </div>
        </article>
      </main>

      {drawerOpen ? (
        <DaySecretaryDrawer
          data={data}
          serviceDate={serviceDate}
          actionPending={actionPending}
          actionMessage={actionMessage}
          onClose={() => setDrawerOpen(false)}
          onAction={
            onOperatingSecretaryAction ?? (() => Promise.resolve())
          }
        />
      ) : null}
    </div>
  );
}

export function AuthoritativeClinicStaffTab({
  clinicId,
  serviceDate,
  onServiceDateChange,
}: {
  clinicId: string;
  serviceDate: string;
  onServiceDateChange: (value: string) => void;
}) {
  const [data, setData] = useState<AuthoritativeClinicStaff | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionPending, setActionPending] = useState(false);
  const [actionMessage, setActionMessage] = useState('');
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    void apiRequest<AuthoritativeClinicStaff>(
      `/practice-location/${encodeURIComponent(clinicId)}/operations/staff?serviceDate=${encodeURIComponent(serviceDate)}`,
    )
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((cause) => {
        if (!cancelled) {
          setData(null);
          setError(
            cause instanceof Error
              ? cause.message
              : 'Unable to load clinic staff assignments.',
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [clinicId, serviceDate, revision]);

  async function handleDaySecretaryAction(action: DaySecretaryAction) {
    setActionPending(true);
    setActionMessage('');
    try {
      if (action.type === 'ASSIGN') {
        await apiRequest('/clinic-days/substitute-secretary/assign', {
          method: 'POST',
          headers: { 'Idempotency-Key': crypto.randomUUID() },
          body: {
            practiceLocationId: clinicId,
            serviceDate,
            userId: action.userId,
          },
        });
        setActionMessage('Secretary assigned for this clinic day.');
      } else if (action.type === 'REPLACE') {
        await apiRequest('/clinic-days/substitute-secretary/replace', {
          method: 'POST',
          headers: { 'Idempotency-Key': crypto.randomUUID() },
          body: {
            clinicDayId: action.clinicDayId,
            userId: action.userId,
          },
        });
        setActionMessage(
          'Secretary for the day changed. Clinic progress and queue order were preserved.',
        );
      } else {
        await apiRequest('/clinic-days/substitute-secretary/end', {
          method: 'POST',
          headers: { 'Idempotency-Key': crypto.randomUUID() },
          body: { clinicDayId: action.clinicDayId },
        });
        setActionMessage('Secretary for the day removed. The Doctor remains in control.');
      }
      setRevision((current) => current + 1);
      window.dispatchEvent(new Event('clinic-operations-refresh'));
    } catch (cause) {
      setActionMessage(
        cause instanceof Error
          ? cause.message
          : 'Unable to change the Secretary for this clinic day.',
      );
    } finally {
      setActionPending(false);
    }
  }

  if (loading) {
    return (
      <div className="ops-workspace-state" role="status">
        Loading authoritative staff assignments…
      </div>
    );
  }
  if (error) {
    return (
      <div className="ops-workspace-state is-error" role="alert">
        <strong>Unable to load clinic staff.</strong>
        <span>{error}</span>
      </div>
    );
  }
  if (!data) {
    return <div className="ops-workspace-state">No staff data is available.</div>;
  }

  return (
    <ClinicStaffView
      data={data}
      serviceDate={serviceDate}
      onServiceDateChange={onServiceDateChange}
      onOperatingSecretaryAction={handleDaySecretaryAction}
      actionPending={actionPending}
      actionMessage={actionMessage}
    />
  );
}
