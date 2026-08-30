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

type OperatingSecretaryAction =
  | { type: 'ASSIGN'; userId: string }
  | { type: 'REPLACE'; clinicDayId: string; userId: string }
  | { type: 'CLEAR'; clinicDayId: string };

function StaffIdentity({ staff }: { staff: ClinicStaffMember | null }) {
  if (!staff) return <p>Not assigned</p>;
  return (
    <div>
      <strong>{staff.name}</strong>
      <small>{staff.email}</small>
      <small>
        {staff.assignmentActive ? 'Active assignment' : 'Inactive assignment'} ·{' '}
        {staff.accountStatus.replaceAll('_', ' ')} account
      </small>
    </div>
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
    action: OperatingSecretaryAction,
  ) => void | Promise<void>;
  actionPending?: boolean;
  actionMessage?: string;
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

  useEffect(() => {
    if (!candidates.some((staff) => staff.userId === selectedUserId)) {
      setSelectedUserId(candidates[0]?.userId ?? '');
    }
  }, [candidates, selectedUserId]);

  const status = data.clinicDay?.status ?? 'NOT_STARTED';
  const terminal = status === 'CLOSED' || status === 'CANCELLED';
  const hasOperatingSecretary = data.operatingSecretary !== null;
  const canReplace = hasOperatingSecretary && status === 'STARTED';
  const canAssign = !hasOperatingSecretary && !terminal;
  const canClear = hasOperatingSecretary && !terminal && data.clinicDay !== null;

  function submitAssignment() {
    if (!selectedUserId || !onOperatingSecretaryAction) return;
    if (canReplace && data.clinicDay) {
      void onOperatingSecretaryAction({
        type: 'REPLACE',
        clinicDayId: data.clinicDay.id,
        userId: selectedUserId,
      });
      return;
    }
    if (canAssign) {
      void onOperatingSecretaryAction({ type: 'ASSIGN', userId: selectedUserId });
    }
  }

  return (
    <div className="ops-staff">
      <div className="ops-summary-strip">
        <ServiceDateControl
          compact
          value={serviceDate}
          onChange={onServiceDateChange}
        />
        <div>
          <span>
            <small>Regular Secretary</small>
            <strong>{data.regularSecretary?.name ?? 'Not assigned'}</strong>
          </span>
        </div>
        <div>
          <span>
            <small>Operating Secretary</small>
            <strong>{data.operatingSecretary?.name ?? 'Not assigned'}</strong>
          </span>
        </div>
        <div>
          <span>
            <small>Clinic Day</small>
            <strong>{status.replaceAll('_', ' ')}</strong>
          </span>
        </div>
      </div>

      <div className="ops-appointment-layout">
        <main>
          <article className="ops-card">
            <h3>Current Regular Secretary</h3>
            <p>
              Location-wide regular assignment. This does not automatically
              grant live-day Operating Secretary authority.
            </p>
            <StaffIdentity staff={data.regularSecretary} />
          </article>

          <article className="ops-card">
            <h3>Operating Secretary for {formatServiceDate(serviceDate, true)}</h3>
            <p>
              Service-date authority from the Clinic Day. Changing this role is
              an authorization handoff and does not restart the clinic or alter
              queue order.
            </p>
            <StaffIdentity staff={data.operatingSecretary} />
          </article>
        </main>

        <aside>
          <article className="ops-card">
            <h3>Practice Staff Assignments ({data.staffAssignments.length})</h3>
            <p>
              These records show location assignment only. Assignment alone is
              not Operating Secretary authority for this service date.
            </p>
            {data.staffAssignments.length ? (
              <ul className="ops-summary-list">
                {data.staffAssignments.map((staff) => (
                  <li key={staff.practiceStaffId}>
                    <span>
                      <strong>{staff.name}</strong>
                      <small>{staff.email}</small>
                    </span>
                    <span>
                      {staff.isRegular ? 'Regular ' : ''}
                      {staff.isOperating ? 'Operating ' : ''}
                      {!staff.isRegular && !staff.isOperating
                        ? 'Assigned'
                        : ''}
                      {!staff.assignmentActive ? ' · Inactive' : ''}
                      {staff.assignmentActive && !staff.operationallyReady
                        ? ' · Not ready'
                        : ''}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p>No PracticeStaff assignments exist for this clinic.</p>
            )}
          </article>
        </aside>
      </div>

      <article className="ops-card">
        <h3>Operating Secretary Control</h3>
        {terminal ? (
          <p>A terminal Clinic Day cannot change Operating Secretary authority.</p>
        ) : null}
        {!terminal && hasOperatingSecretary && status !== 'STARTED' ? (
          <p>
            Before the clinic starts, clear the existing Operating Secretary
            before assigning a different one. Mid-day replacement becomes
            available after START CLINIC.
          </p>
        ) : null}
        {!terminal && (canAssign || canReplace) ? (
          <div>
            <label htmlFor="operating-secretary-candidate">
              {canReplace
                ? 'Replacement Operating Secretary'
                : 'Operating Secretary'}
            </label>
            <select
              id="operating-secretary-candidate"
              value={selectedUserId}
              onChange={(event) => setSelectedUserId(event.target.value)}
              disabled={actionPending || candidates.length === 0}
            >
              {candidates.length === 0 ? (
                <option value="">No operationally-ready Secretary available</option>
              ) : null}
              {candidates.map((staff) => (
                <option key={staff.practiceStaffId} value={staff.userId}>
                  {staff.name}{staff.isRegular ? ' · Regular Secretary' : ''}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="ops-action is-blue"
              disabled={
                actionPending ||
                !selectedUserId ||
                candidates.length === 0 ||
                !onOperatingSecretaryAction
              }
              onClick={submitAssignment}
            >
              {actionPending
                ? 'UPDATING…'
                : canReplace
                  ? 'REPLACE OPERATING SECRETARY'
                  : 'ASSIGN OPERATING SECRETARY'}
            </button>
          </div>
        ) : null}
        {canClear ? (
          <button
            type="button"
            className="ops-action is-outline"
            disabled={actionPending || !onOperatingSecretaryAction}
            onClick={() =>
              data.clinicDay &&
              void onOperatingSecretaryAction?.({
                type: 'CLEAR',
                clinicDayId: data.clinicDay.id,
              })
            }
          >
            CLEAR OPERATING SECRETARY
          </button>
        ) : null}
        {!terminal && !hasOperatingSecretary && candidates.length === 0 ? (
          <p>
            No operationally-ready PracticeStaff Secretary is available for
            this clinic.
          </p>
        ) : null}
        {actionMessage ? (
          <div className="clinic-local-notice" role="status">
            {actionMessage}
          </div>
        ) : null}
      </article>
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

  async function handleOperatingSecretaryAction(
    action: OperatingSecretaryAction,
  ) {
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
        setActionMessage('Operating Secretary assigned for this service date.');
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
          'Operating Secretary replaced. Clinic runtime and queue order were preserved.',
        );
      } else {
        await apiRequest('/clinic-days/substitute-secretary/end', {
          method: 'POST',
          headers: { 'Idempotency-Key': crypto.randomUUID() },
          body: { clinicDayId: action.clinicDayId },
        });
        setActionMessage('Operating Secretary cleared. The Doctor remains in control.');
      }
      setRevision((current) => current + 1);
      window.dispatchEvent(new Event('clinic-operations-refresh'));
    } catch (cause) {
      setActionMessage(
        cause instanceof Error
          ? cause.message
          : 'Unable to change Operating Secretary authority.',
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
      onOperatingSecretaryAction={handleOperatingSecretaryAction}
      actionPending={actionPending}
      actionMessage={actionMessage}
    />
  );
}
