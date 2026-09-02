import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { apiRequest } from '../api/client';

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
  if (loading || error) return <PageState loading={loading} error={error} />;
  return (
    <section className="secretary-page">
      <header>
        <p className="doctor-placeholder-eyebrow">Secretary workspace</p>
        <h1>Clinics</h1>
        <p>Clinics appear here only after you accept a Doctor’s invitation.</p>
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
        <div className="secretary-clinic-grid">
          {data.clinics.map((clinic) => (
            <article
              className="secretary-clinic-card"
              key={clinic.practiceStaffId}
            >
              <div className="secretary-card-top">
                <span className="secretary-clinic-mark">+</span>
                <span
                  className={`secretary-status is-${clinic.status.toLowerCase()}`}
                >
                  {clinic.status === 'ACTIVE' ? 'Active' : 'Disabled'}
                </span>
              </div>
              <h2>{clinic.clinicName}</h2>
              <p>{clinic.address || 'Clinic address not provided'}</p>
              <dl>
                <div>
                  <dt>Doctor</dt>
                  <dd>{clinic.doctorName}</dd>
                </div>
                <div>
                  <dt>Role</dt>
                  <dd>
                    {clinic.assignmentType === 'CLINIC_SECRETARY'
                      ? 'Clinic Secretary'
                      : 'Substitute Secretary'}
                  </dd>
                </div>
              </dl>
              <Link
                className="secretary-open-clinic"
                to={`/app/secretary/clinics/${encodeURIComponent(clinic.clinicId)}`}
              >
                Open Clinic
              </Link>
            </article>
          ))}
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
  const modules =
    clinic.assignmentType === 'SUBSTITUTE_SECRETARY'
      ? [
          {
            title: 'Queue',
            copy: 'Live queue and clinic-day operations during your approved coverage.',
          },
        ]
      : [
          ...(clinic.authorityBundles.includes(
            'QUEUE_AND_CLINIC_DAY_OPERATIONS',
          )
            ? [{ title: 'Queue', copy: 'Queue and clinic-day operations.' }]
            : []),
          ...(clinic.authorityBundles.includes(
            'APPOINTMENTS_AND_PATIENT_INTAKE',
          )
            ? [
                {
                  title: 'Appointments',
                  copy: 'Appointments and patient intake.',
                },
              ]
            : []),
          ...(clinic.authorityBundles.includes('CLINIC_CONFIGURATION_DRAFTING')
            ? [
                {
                  title: 'Clinic Configuration',
                  copy: 'Prepare configuration drafts for Doctor approval.',
                },
              ]
            : []),
          ...(clinic.authorityBundles.includes('REPORTS_VIEW_ONLY')
            ? [
                {
                  title: 'Reports',
                  copy: 'View clinic reports without editing operational records.',
                },
              ]
            : []),
        ];
  return (
    <section className="secretary-page secretary-clinic-workspace">
      <Link to="/app/secretary/clinics">← Back to Clinics</Link>
      <header>
        <p className="doctor-placeholder-eyebrow">
          {clinic.assignmentType === 'CLINIC_SECRETARY'
            ? 'Clinic Secretary'
            : 'Substitute Secretary'}
        </p>
        <h1>{clinic.clinicName}</h1>
        <p>
          {clinic.address || clinic.timeZone} · Dr. {clinic.doctorName}
        </p>
      </header>
      {clinic.status === 'DISABLED' ? (
        <div className="secretary-notice is-warning">
          Your access at this clinic is disabled. Clinic modules are read-only
          until the Doctor reactivates the relationship.
        </div>
      ) : null}
      <div className="secretary-module-grid">
        {modules.map((module) => (
          <article key={module.title}>
            <h2>{module.title}</h2>
            <p>{module.copy}</p>
            <span>
              {clinic.status === 'ACTIVE' ? 'Granted' : 'Unavailable'}
            </span>
          </article>
        ))}
      </div>
    </section>
  );
}
