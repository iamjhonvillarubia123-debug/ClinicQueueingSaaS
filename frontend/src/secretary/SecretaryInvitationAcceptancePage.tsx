import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { apiRequest } from '../api/client';
import { useAuth } from '../auth/AuthContext';

type InvitationPreview = {
  name: string;
  email: string;
  clinicName: string;
  expiresAt: string;
  assignmentType: 'CLINIC_SECRETARY' | 'SUBSTITUTE_SECRETARY';
  authorityBundles: string[];
  requestedCancelClinicDay: boolean;
  coverageMode: 'ONE_SERVICE_DATE' | 'DATE_RANGE' | null;
  fromServiceDate: string | null;
  toServiceDate: string | null;
};
const bundleLabels: Record<string, string> = {
  QUEUE_AND_CLINIC_DAY_OPERATIONS: 'Queue & Clinic Day Operations',
  APPOINTMENTS_AND_PATIENT_INTAKE: 'Appointments & Patient Intake',
  CLINIC_CONFIGURATION_DRAFTING: 'Clinic Configuration Drafting',
  REPORTS_VIEW_ONLY: 'Reports · View Only',
};

export function SecretaryInvitationAcceptancePage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const destination = `/secretary-invitations/accept?token=${encodeURIComponent(token)}`;
  const { status, profile } = useAuth();
  const [preview, setPreview] = useState<InvitationPreview | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [accepted, setAccepted] = useState(false);
  useEffect(() => {
    if (!token) {
      setError('This invitation link is invalid or incomplete.');
      setLoading(false);
      return;
    }
    void apiRequest<InvitationPreview>(
      `/practice-staff/invitations/preview?token=${encodeURIComponent(token)}`,
    )
      .then(setPreview)
      .catch((cause: unknown) =>
        setError(
          cause instanceof Error
            ? cause.message
            : 'Unable to open this invitation.',
        ),
      )
      .finally(() => setLoading(false));
  }, [token]);
  async function accept() {
    setError('');
    setSubmitting(true);
    try {
      await apiRequest('/practice-staff/invitations/accept', {
        method: 'POST',
        body: { token },
      });
      setAccepted(true);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Unable to accept this invitation.',
      );
    } finally {
      setSubmitting(false);
    }
  }
  if (loading || status === 'loading')
    return (
      <main className="centered-page">
        <section className="auth-panel" role="status">
          Opening your invitation…
        </section>
      </main>
    );
  if (accepted)
    return (
      <main className="centered-page">
        <section className="auth-panel invitation-success">
          <span aria-hidden="true">✓</span>
          <h1>Clinic Assignment Accepted</h1>
          <p>Your clinic relationship is ready.</p>
          <Link className="link-button" to="/app/secretary">
            Open Secretary Workspace
          </Link>
        </section>
      </main>
    );
  return (
    <main className="auth-page">
      <section className="auth-panel">
        <Link className="brand" to="/">
          CLINIC QUEUEING
        </Link>
        <div className="auth-heading">
          <p className="eyebrow">Secretary invitation</p>
          <h1>Clinic relationship invitation</h1>
          {preview ? (
            <p>
              {preview.name}, you were invited to join{' '}
              <strong>{preview.clinicName}</strong>.
            </p>
          ) : null}
        </div>
        {error && !preview ? (
          <>
            <div className="form-error" role="alert">
              {error}
            </div>
            <p>
              <Link to="/login">Return to sign in</Link>
            </p>
          </>
        ) : null}
        {preview ? (
          <div className="stack">
            <dl className="staff-review">
              <div>
                <dt>Email</dt>
                <dd>{preview.email}</dd>
              </div>
              <div>
                <dt>Role</dt>
                <dd>
                  {preview.assignmentType === 'CLINIC_SECRETARY'
                    ? 'Clinic Secretary'
                    : 'Substitute Secretary'}
                </dd>
              </div>
              {preview.assignmentType === 'CLINIC_SECRETARY' ? (
                <div>
                  <dt>Authority</dt>
                  <dd>
                    {preview.authorityBundles
                      .map((item) => bundleLabels[item] ?? item)
                      .join(', ')}
                    {preview.requestedCancelClinicDay
                      ? ', Cancel Clinic Day'
                      : ''}
                  </dd>
                </div>
              ) : (
                <div>
                  <dt>Coverage</dt>
                  <dd>
                    {preview.fromServiceDate?.slice(0, 10)} –{' '}
                    {preview.toServiceDate?.slice(0, 10)}
                  </dd>
                </div>
              )}
            </dl>
            {status === 'anonymous' ? (
              <>
                <p>
                  This invitation assigns a clinic relationship; it does not
                  create your account. Create and verify a Secretary account
                  using the invited email, or sign in to your existing account,
                  then return here.
                </p>
                <Link
                  className="link-button"
                  to="/login"
                  state={{ from: destination }}
                >
                  Sign In
                </Link>
                <Link
                  to={`/register?role=SECRETARY&returnTo=${encodeURIComponent(destination)}`}
                >
                  Create Secretary Account
                </Link>
              </>
            ) : profile?.role !== 'SECRETARY' ? (
              <div className="form-error" role="alert">
                This invitation can only be accepted while signed in as a
                Secretary.
              </div>
            ) : (
              <>
                <button
                  className="primary"
                  type="button"
                  disabled={submitting}
                  onClick={() => void accept()}
                >
                  {submitting ? 'Accepting…' : 'Accept Invitation'}
                </button>
                <p className="invitation-scope-note">
                  Acceptance establishes only the clinic relationship shown
                  above. It does not create or change your account password.
                </p>
              </>
            )}
            {error ? (
              <div className="form-error" role="alert">
                {error}
              </div>
            ) : null}
          </div>
        ) : null}
      </section>
    </main>
  );
}
