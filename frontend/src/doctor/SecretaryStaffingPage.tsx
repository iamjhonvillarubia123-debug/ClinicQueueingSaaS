import { FormEvent, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ApiError, apiRequest } from '../api/client';

type InvitationResult =
  | { outcome: 'INVITATION_CREATED'; invitationId: string; expiresAt: string }
  | { outcome: 'EXISTING_SECRETARY'; secretaryUserId: string; eligibleForAssignment: boolean };
type PracticeLocation = { id: string; currentRegularPracticeStaffId: string | null };

function errorMessage(error: unknown) { return error instanceof ApiError ? error.message : 'Unable to complete the staffing action. Please try again.'; }

export function SecretaryStaffingPage() {
  const { practiceLocationId } = useParams();
  const navigate = useNavigate();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [mobileNumber, setMobileNumber] = useState('');
  const [busy, setBusy] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [existingSecretaryUserId, setExistingSecretaryUserId] = useState<string | null>(null);
  const [existingEligible, setExistingEligible] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!practiceLocationId || busy) return;
    setBusy(true); setError(''); setNotice(''); setExistingSecretaryUserId(null);
    try {
      const result = await apiRequest<InvitationResult>('/secretary/invitations', { method: 'POST', body: { practiceLocationId, firstName, lastName, email, mobileNumber } });
      if (result.outcome === 'EXISTING_SECRETARY') {
        setExistingSecretaryUserId(result.secretaryUserId); setExistingEligible(result.eligibleForAssignment);
        setNotice(result.eligibleForAssignment ? 'This email already belongs to a Secretary account. Assign the existing Secretary instead of creating an invitation.' : 'This email belongs to a Secretary account that is not currently eligible for assignment.');
        return;
      }
      setNotice('Invitation created. A secure 72-hour invitation link will be delivered to the Secretary email address.'); setFirstName(''); setLastName(''); setEmail(''); setMobileNumber('');
    } catch (caught) { setError(errorMessage(caught)); } finally { setBusy(false); }
  }

  async function assignmentNowExists() {
    if (!practiceLocationId) return false;
    try {
      const locations = await apiRequest<PracticeLocation[]>('/practice-location');
      return Boolean(locations.find((location) => location.id === practiceLocationId)?.currentRegularPracticeStaffId);
    } catch { return false; }
  }

  async function assignExisting() {
    if (!practiceLocationId || !existingSecretaryUserId || !existingEligible || assigning) return;
    setAssigning(true); setError('');
    try {
      await apiRequest('/practice-staff/regular/assign', { method: 'POST', headers: { 'Idempotency-Key': crypto.randomUUID() }, body: { practiceLocationId, userId: existingSecretaryUserId } });
      navigate('/app/practice-locations', { replace: true });
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 409 && await assignmentNowExists()) {
        navigate('/app/practice-locations', { replace: true });
        return;
      }
      setError(errorMessage(caught));
    } finally { setAssigning(false); }
  }

  return <section className="practice-admin-page" aria-labelledby="secretary-staffing-heading">
    <div className="practice-admin-heading"><div><p className="eyebrow">Clinic staffing</p><h1 id="secretary-staffing-heading">Secretary onboarding</h1><p>Invite a new Secretary to this clinic. If the email already belongs to a Secretary account, the system routes you to the existing-account assignment instead.</p></div><Link className="secondary-action" to="/app/practice-locations">← Back to clinic locations</Link></div>
    {error ? <div className="form-error" role="alert">{error}</div> : null}{notice ? <div className="practice-notice practice-success" role="status">{notice}</div> : null}
    <section className="practice-create-panel"><div className="practice-panel-heading"><p className="eyebrow">Invite new Secretary</p><h2>Send a secure invitation</h2><p>The Secretary chooses their own password. No Secretary account or clinic assignment is created until the invitation is accepted successfully.</p></div><form className="practice-form" onSubmit={invite}><div className="practice-form-grid"><label>First name<input required maxLength={100} autoComplete="given-name" value={firstName} onChange={(event) => setFirstName(event.target.value)} /></label><label>Last name<input required maxLength={100} autoComplete="family-name" value={lastName} onChange={(event) => setLastName(event.target.value)} /></label></div><label>Email<input required type="email" maxLength={255} autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label><label>Mobile number<input required type="tel" maxLength={30} autoComplete="tel" placeholder="09… or +63…" value={mobileNumber} onChange={(event) => setMobileNumber(event.target.value)} /></label><button className="primary" type="submit" disabled={busy}>{busy ? 'Creating invitation…' : 'Send invitation'}</button></form></section>
    {existingSecretaryUserId ? <section className="practice-create-panel"><div className="practice-panel-heading"><p className="eyebrow">Existing Secretary</p><h2>Assign existing account</h2><p>No invitation or second account will be created for an existing Secretary.</p></div><button className="primary" type="button" disabled={!existingEligible || assigning} onClick={assignExisting}>{assigning ? 'Assigning…' : 'Assign existing Secretary'}</button></section> : null}
  </section>;
}
