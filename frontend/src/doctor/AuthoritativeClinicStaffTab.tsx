import { useEffect, useState } from 'react';
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
}: {
  data: AuthoritativeClinicStaff;
  serviceDate: string;
  onServiceDateChange: (value: string) => void;
}) {
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
            <strong>{data.clinicDay?.status.replaceAll('_', ' ') ?? 'NOT STARTED'}</strong>
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

      <div className="ops-workspace-state">
        <strong>Staff changes are not enabled in this checkpoint.</strong>
        <span>
          Regular replacement/removal and Operating Secretary handoff remain
          governed, high-risk actions and will be wired separately with their
          required authorization and audit controls.
        </span>
      </div>
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
  }, [clinicId, serviceDate]);

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
    />
  );
}
