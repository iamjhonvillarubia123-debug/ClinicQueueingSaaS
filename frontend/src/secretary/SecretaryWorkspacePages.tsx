import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { apiRequest } from '../api/client';
import { AuthoritativeClinicOperationsRoutePage } from '../doctor/AuthoritativeClinicOperationsRoutePage';
import type { OperationsTab } from '../doctor/AuthoritativeClinicOperationsWorkspace';

export type SecretaryClinic = {
  practiceStaffId: string;
  clinicId: string;
  clinicName: string;
  address: string | null;
  timeZone: string;
  doctorName: string;
  status: 'ACTIVE' | 'DISABLED';
  assignmentType: 'CLINIC_SECRETARY' | 'SUBSTITUTE_SECRETARY';
  authorityBundles: string[];
  substituteCoverages: Array<{
    id: string;
    coverageMode: 'ONE_SERVICE_DATE' | 'DATE_RANGE';
    fromServiceDate: string;
    toServiceDate: string;
  }>;
  assignedAt: string;
};

export type SecretaryWorkspaceData = {
  clinics: SecretaryClinic[];
  invitations: Array<{
    invitationId: string;
    clinicId: string;
    clinicName: string;
    doctorName: string;
    assignmentType: 'CLINIC_SECRETARY' | 'SUBSTITUTE_SECRETARY';
    authorityBundles: string[];
    requestedCancelClinicDay: boolean;
    coverageMode: 'ONE_SERVICE_DATE' | 'DATE_RANGE' | null;
    fromServiceDate: string | null;
    toServiceDate: string | null;
    invitedAt: string;
    expiresAt: string;
  }>;
};

const bundleLabels: Record<string, string> = {
  QUEUE_AND_CLINIC_DAY_OPERATIONS: 'Queue & Clinic Day Operations',
  APPOINTMENTS_AND_PATIENT_INTAKE: 'Appointments & Patient Intake',
  CLINIC_CONFIGURATION_DRAFTING: 'Clinic Configuration Drafting',
  REPORTS_VIEW_ONLY: 'Reports · View Only',
};

function useSecretaryWorkspace(revision = 0) {
  const [data, setData] = useState<SecretaryWorkspaceData | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    void apiRequest<SecretaryWorkspaceData>('/secretary/workspace')
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((cause: unknown) => {
        if (!cancelled)
          setError(
            cause instanceof Error
              ? cause.message
              : 'Unable to load the Secretary workspace.',
          );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [revision]);
  return { data, error, loading };
}

function PageState({ loading, error }: { loading: boolean; error: string }) {
  if (loading)
    return (
      <div className="secretary-state" role="status">
        Loading workspace…
      </div>
    );
  if (error)
    return (
      <div className="secretary-state is-error" role="alert">
        {error}
      </div>
    );
  return null;
}

export function SecretaryClinicsPage() {
  const { data, error, loading } = useSecretaryWorkspace();
  const [filter, setFilter] = useState<'ALL' | 'ACTIVE' | 'DISABLED'>('ALL');
  const [search, setSearch] = useState('');
  if (loading || error) return <PageState loading={loading} error={error} />;
  const clinics = (data?.clinics ?? []).filter(
    (clinic) =>
      (filter === 'ALL' || clinic.status === filter) &&
      `${clinic.clinicName} ${clinic.address ?? ''} ${clinic.doctorName}`
        .toLowerCase()
        .includes(search.trim().toLowerCase()),
  );
  const count = (status: 'ACTIVE' | 'DISABLED') =>
    data?.clinics.filter((clinic) => clinic.status === status).length ?? 0;
  return (
    <section className="secretary-page">
      <header>
        <h1>Clinics</h1>
        <p>Open clinics connected to your account and work within the authority granted by each Doctor.</p>
      </header>
      {!data?.clinics.length ? (
        <div className="secretary-empty">
          <span aria-hidden="true">＋</span>
          <h2>No connected clinics</h2>
          <p>
            Open Invitations to review clinic relationships offered to your
            account.
          </p>
          <Link className="link-button" to="/app/secretary/invitations">
            View Invitations
          </Link>
        </div>
      ) : (
        <div className="secretary-clinic-browser">
          <div className="secretary-clinic-toolbar">
            <div className="secretary-clinic-filters" aria-label="Clinic filters">
              {(['ALL', 'ACTIVE', 'DISABLED'] as const).map((value) => (
                <button className={filter === value ? 'is-active' : ''} key={value} onClick={() => setFilter(value)}>
                  {value === 'ALL' ? 'All Clinics' : value === 'ACTIVE' ? 'Active' : 'Disabled'}{' '}
                  <span>{value === 'ALL' ? data.clinics.length : count(value)}</span>
                </button>
              ))}
            </div>
            <input aria-label="Search clinics" placeholder="Search clinics…" value={search} onChange={(event) => setSearch(event.target.value)} />
          </div>
          <div className="secretary-clinic-list">
            {clinics.map((clinic) => {
              const canOpen = clinic.status === 'ACTIVE' &&
                (clinic.assignmentType === 'SUBSTITUTE_SECRETARY' || clinic.authorityBundles.some((bundle) => bundle !== 'CLINIC_CONFIGURATION_DRAFTING'));
              return (
                <article key={clinic.practiceStaffId}>
                  <span className="secretary-clinic-mark">+</span>
                  <div className="secretary-clinic-identity">
                    <h2>{clinic.clinicName}</h2>
                    <p>{clinic.address || 'Clinic address not provided'}</p>
                    <small>{clinic.timeZone}</small>
                  </div>
                  <span className={`secretary-status is-${clinic.status.toLowerCase()}`}>{clinic.status}</span>
                  <div className="secretary-clinic-doctor"><strong>Doctor</strong><span>{clinic.doctorName}</span></div>
                  <div className="secretary-clinic-role"><strong>Role</strong><span>{clinic.assignmentType === 'CLINIC_SECRETARY' ? 'Clinic Secretary' : 'Substitute Secretary'}</span></div>
                  {canOpen ? (
                    <Link className="secretary-open-clinic" to={`/app/secretary/clinics/${encodeURIComponent(clinic.clinicId)}`}>Open Clinic</Link>
                  ) : (
                    <button className="secretary-open-clinic" disabled>{clinic.status === 'DISABLED' ? 'Access Disabled' : 'No Live Access'}</button>
                  )}
                </article>
              );
            })}
            {!clinics.length ? <p className="secretary-no-results">No clinics match this view.</p> : null}
          </div>
        </div>
      )}
    </section>
  );
}

export function SecretaryInvitationsPage() {
  const [revision, setRevision] = useState(0);
  const { data, error, loading } = useSecretaryWorkspace(revision);
  const [accepting, setAccepting] = useState('');
  const [message, setMessage] = useState('');
  async function accept(invitationId: string) {
    setAccepting(invitationId);
    setMessage('');
    try {
      await apiRequest(
        `/practice-staff/invitations/${encodeURIComponent(invitationId)}/accept`,
        { method: 'POST' },
      );
      setMessage(
        'Invitation accepted. The clinic is now available in Clinics.',
      );
      setRevision((value) => value + 1);
    } catch (cause) {
      setMessage(
        cause instanceof Error
          ? cause.message
          : 'Unable to accept this invitation.',
      );
    } finally {
      setAccepting('');
    }
  }
  if (loading || error) return <PageState loading={loading} error={error} />;
  return (
    <section className="secretary-page">
      <header>
        <p className="doctor-placeholder-eyebrow">Secretary workspace</p>
        <h1>Invitations</h1>
        <p>
          Review clinic relationships sent to your verified Secretary account.
        </p>
      </header>
      {message ? (
        <div className="secretary-notice" role="status">
          {message}
        </div>
      ) : null}
      {!data?.invitations.length ? (
        <div className="secretary-empty">
          <h2>No pending invitations</h2>
          <p>New invitations from Doctors will appear here.</p>
        </div>
      ) : (
        <div className="secretary-invitation-list">
          {data.invitations.map((invitation) => (
            <article key={invitation.invitationId}>
              <div>
                <span className="secretary-invite-icon">✉</span>
                <div>
                  <h2>{invitation.clinicName}</h2>
                  <p>Invited by Dr. {invitation.doctorName}</p>
                </div>
                <span className="secretary-status is-pending">Pending</span>
              </div>
              <dl>
                <div>
                  <dt>Role</dt>
                  <dd>
                    {invitation.assignmentType === 'CLINIC_SECRETARY'
                      ? 'Clinic Secretary'
                      : 'Substitute Secretary'}
                  </dd>
                </div>
                <div>
                  <dt>Authority</dt>
                  <dd>
                    {invitation.assignmentType === 'CLINIC_SECRETARY'
                      ? invitation.authorityBundles
                          .map((bundle) => bundleLabels[bundle] ?? bundle)
                          .join(', ')
                      : `Live clinic and queue operations · ${invitation.fromServiceDate?.slice(0, 10)} – ${invitation.toServiceDate?.slice(0, 10)}`}
                  </dd>
                </div>
                <div>
                  <dt>Expires</dt>
                  <dd>{new Date(invitation.expiresAt).toLocaleString()}</dd>
                </div>
              </dl>
              <footer>
                <button
                  className="is-primary"
                  disabled={Boolean(accepting)}
                  onClick={() => void accept(invitation.invitationId)}
                >
                  {accepting === invitation.invitationId
                    ? 'Accepting…'
                    : 'Accept Invitation'}
                </button>
              </footer>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

export function SecretaryClinicWorkspacePage() {
  const { clinicId } = useParams();
  const { data, error, loading } = useSecretaryWorkspace();
  const clinic = useMemo(
    () => data?.clinics.find((item) => item.clinicId === clinicId),
    [clinicId, data],
  );
  if (loading || error) return <PageState loading={loading} error={error} />;
  if (!clinic)
    return (
      <div className="secretary-state is-error" role="alert">
        This clinic is not connected to your Secretary account.
      </div>
    );
  if (clinic.status === 'DISABLED')
    return (
      <section className="secretary-page">
        <Link to="/app/secretary/clinics">← Back to Clinics</Link>
        <div className="secretary-state is-error" role="alert">
          Your access at this clinic is disabled. Ask the Doctor to reactivate
          the relationship before opening clinic operations.
        </div>
      </section>
    );
  const canUseQueue =
    clinic.assignmentType === 'SUBSTITUTE_SECRETARY' ||
    clinic.authorityBundles.includes('QUEUE_AND_CLINIC_DAY_OPERATIONS');
  const canViewAppointments = clinic.authorityBundles.some((bundle) =>
    ['APPOINTMENTS_AND_PATIENT_INTAKE', 'REPORTS_VIEW_ONLY'].includes(bundle),
  );
  const canGenerateReports = clinic.authorityBundles.includes(
    'REPORTS_VIEW_ONLY',
  );
  const visibleTabs: OperationsTab[] = [
    ...(canUseQueue ? (['overview', 'queue'] as OperationsTab[]) : []),
    ...(canViewAppointments ? (['appointments'] as OperationsTab[]) : []),
  ];
  if (!visibleTabs.length)
    return (
      <section className="secretary-page">
        <Link to="/app/secretary/clinics">← Back to Clinics</Link>
        <div className="secretary-empty">
          <h2>No operational access granted</h2>
          <p>Your current authority does not include a live clinic module.</p>
        </div>
      </section>
    );
  return (
    <AuthoritativeClinicOperationsRoutePage
      visibleTabs={visibleTabs}
      canUseQueue={canUseQueue}
      canViewAppointments={canViewAppointments}
      canGenerateReports={canGenerateReports}
      backTo="/app/secretary/clinics"
    />
  );
}
