import { FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ApiError, apiRequest } from '../api/client';
import { ClinicConfigurationTabs } from './ClinicConfigurationTabs';

type SecretaryUser = {
  id: string;
  firstName: string;
  middleName: string | null;
  lastName: string;
  email: string;
  mobileNumber: string;
  emailVerifiedAt: string | null;
  accountStatus: string;
  administrativeRestrictionStatus: string;
};
type Staffing = {
  location: { id: string; name: string | null; lifecycleStatus: string; currentRegularPracticeStaffId: string | null };
  regularSecretary: { id: string; isActive: boolean; createdAt: string; user: SecretaryUser } | null;
};
type ExistingResult = { user: SecretaryUser; eligible: boolean };
type InvitationResult =
  | { outcome: 'INVITATION_CREATED'; invitationId: string; expiresAt: string }
  | { outcome: 'EXISTING_SECRETARY'; secretaryUserId: string; eligibleForAssignment: boolean };

function errorMessage(error: unknown) {
  return error instanceof ApiError ? error.message : 'Unable to complete the staffing action. Please try again.';
}
function fullName(user: SecretaryUser) {
  return [user.firstName, user.middleName, user.lastName].filter(Boolean).join(' ');
}

export function SecretaryStaffingPage() {
  const { practiceLocationId } = useParams();
  const navigate = useNavigate();
  const [staffing, setStaffing] = useState<Staffing | null>(null);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<'none' | 'add' | 'replace-existing' | 'replace-new'>('none');
  const [email, setEmail] = useState('');
  const [candidate, setCandidate] = useState<ExistingResult | null>(null);
  const [password, setPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [mobileNumber, setMobileNumber] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  async function load() {
    if (!practiceLocationId) return;
    setLoading(true); setError('');
    try { setStaffing(await apiRequest<Staffing>(`/practice-staff/regular/${encodeURIComponent(practiceLocationId)}`)); }
    catch (caught) { setError(errorMessage(caught)); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, [practiceLocationId]);

  async function resolveExisting(event: FormEvent) {
    event.preventDefault(); if (!practiceLocationId || busy) return;
    setBusy(true); setError(''); setCandidate(null);
    try {
      const result = await apiRequest<ExistingResult>(`/practice-staff/regular/${encodeURIComponent(practiceLocationId)}/resolve-existing`, { method: 'POST', body: { email } });
      setCandidate(result);
    } catch (caught) { setError(errorMessage(caught)); }
    finally { setBusy(false); }
  }

  async function assignOrReplace() {
    if (!practiceLocationId || !candidate?.eligible || busy) return;
    setBusy(true); setError(''); setNotice('');
    try {
      if (staffing?.regularSecretary) {
        await apiRequest('/practice-staff/regular/replace', {
          method: 'POST', headers: { 'Idempotency-Key': crypto.randomUUID() },
          body: { practiceLocationId, userId: candidate.user.id, password },
        });
        setNotice('Regular Secretary replaced successfully.');
      } else {
        await apiRequest('/practice-staff/regular/assign', {
          method: 'POST', headers: { 'Idempotency-Key': crypto.randomUUID() },
          body: { practiceLocationId, userId: candidate.user.id },
        });
        setNotice('Existing Secretary assigned successfully.');
      }
      setMode('none'); setCandidate(null); setEmail(''); setPassword(''); await load();
    } catch (caught) { setError(errorMessage(caught)); }
    finally { setBusy(false); }
  }

  async function inviteNew(event: FormEvent) {
    event.preventDefault(); if (!practiceLocationId || busy || staffing?.regularSecretary) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await apiRequest<InvitationResult>('/secretary/invitations', { method: 'POST', body: { practiceLocationId, firstName, lastName, email, mobileNumber } });
      if (result.outcome === 'EXISTING_SECRETARY') {
        setMode('add'); setCandidate({ user: { id: result.secretaryUserId, firstName, middleName: null, lastName, email, mobileNumber, emailVerifiedAt: null, accountStatus: 'ACTIVE', administrativeRestrictionStatus: 'NONE' }, eligible: result.eligibleForAssignment });
        setNotice('That email already belongs to a Secretary account. Confirm the existing-account assignment below.');
      } else {
        setNotice('Secure Secretary invitation created. The clinic remains without a regular Secretary until acceptance completes.');
        setMode('none'); setFirstName(''); setLastName(''); setEmail(''); setMobileNumber('');
      }
    } catch (caught) { setError(errorMessage(caught)); }
    finally { setBusy(false); }
  }

  if (loading) return <section className="practice-admin-page"><p className="practice-muted">Loading clinic staff…</p></section>;
  if (!practiceLocationId || !staffing) return <section className="practice-admin-page"><div className="form-error" role="alert">{error || 'Clinic staffing was not found.'}</div></section>;
  const secretary = staffing.regularSecretary?.user ?? null;

  return (
    <section className="practice-admin-page" aria-labelledby="clinic-staff-heading">
      <div className="practice-admin-heading"><div><p className="eyebrow">Clinic configuration</p><h1 id="clinic-staff-heading">{staffing.location.name || 'Clinic'} staff</h1><p>Manage the current regular Secretary and the clinic-specific authority that follows the assignment.</p></div><Link className="secondary-action" to="/app/practice-locations">← Back to clinic locations</Link></div>
      <ClinicConfigurationTabs practiceLocationId={practiceLocationId} active="staff" />
      {error ? <div className="form-error" role="alert">{error}</div> : null}
      {notice ? <div className="practice-notice practice-success" role="status">{notice}</div> : null}

      <div className="clinic-staff-grid">
        <section className="practice-create-panel">
          <div className="practice-panel-heading"><p className="eyebrow">Assigned Secretary</p><h2>{secretary ? fullName(secretary) : 'No regular Secretary'}</h2></div>
          {secretary ? <div className="staff-identity"><p><strong>{secretary.email}</strong></p><p>{secretary.mobileNumber}</p><p>{secretary.emailVerifiedAt ? 'Email verified' : 'Email verification incomplete'} · {staffing.regularSecretary?.isActive ? 'Assignment active' : 'Assignment inactive'}</p><p className="practice-muted">Assigned {new Date(staffing.regularSecretary!.createdAt).toLocaleDateString()}</p></div> : <p className="practice-muted">The Doctor currently manages this clinic without a regular Secretary.</p>}
        </section>

        <section className="practice-create-panel">
          <div className="practice-panel-heading"><p className="eyebrow">Secretary authority</p><h2>Clinic-specific controls</h2><p>Secretary changes to configuration remain proposals until Doctor approval.</p></div>
          <div className="staff-authority-list">
            {['Services', 'Booking questions', 'Recurring clinic schedule', 'Schedule exceptions', 'Settings drafts'].map((label) => <div className="staff-authority-row" key={label}><span>{label}</span><strong>Allowed by assignment</strong></div>)}
          </div>
          <p className="practice-muted">Live queue authority is controlled separately by the applicable ClinicDay. Frontend visibility does not grant backend authority.</p>
        </section>
      </div>

      {secretary ? (
        <section className="practice-create-panel">
          <div className="practice-panel-heading"><p className="eyebrow">Change Secretary</p><h2>Replace the current regular Secretary</h2><p>Replacement is atomic and password-protected. The outgoing Secretary loses this clinic's current regular authority only after replacement succeeds.</p></div>
          {mode === 'none' ? <div className="button-row"><button className="primary" type="button" onClick={() => setMode('replace-existing')}>Replace Secretary</button></div> : null}
          {mode === 'replace-existing' || mode === 'replace-new' ? <div className="clinic-replacement-choices"><button className={mode === 'replace-existing' ? 'primary' : 'secondary'} type="button" onClick={() => { setMode('replace-existing'); setCandidate(null); }}>Existing Secretary</button><button className={mode === 'replace-new' ? 'primary' : 'secondary'} type="button" onClick={() => setMode('replace-new')}>New Secretary</button><button className="secondary" type="button" onClick={() => { setMode('none'); setCandidate(null); setPassword(''); }}>Cancel</button></div> : null}
          {mode === 'replace-existing' ? <form className="practice-form" onSubmit={resolveExisting}><label>Existing Secretary email<input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label><button className="secondary" disabled={busy || !email.trim()} type="submit">Find existing Secretary</button></form> : null}
          {mode === 'replace-new' ? <div className="practice-notice"><strong>New replacement onboarding requires a protected candidate lifecycle.</strong><p>The current Secretary must remain authorized while the new person completes onboarding, and final replacement must still require the Doctor's current password. The existing backend invitation contract cannot safely do both yet.</p></div> : null}
          {candidate ? <div className="practice-create-panel"><h3>{fullName(candidate.user)}</h3><p>{candidate.user.email} · {candidate.user.mobileNumber}</p><p>{candidate.eligible ? 'Eligible for assignment' : 'Not currently eligible for assignment'}</p>{staffing.regularSecretary ? <label>Current Doctor password<input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></label> : null}<button className="primary" type="button" disabled={busy || !candidate.eligible || Boolean(staffing.regularSecretary && !password)} onClick={() => void assignOrReplace()}>{staffing.regularSecretary ? 'Confirm replacement' : 'Assign Secretary'}</button></div> : null}
        </section>
      ) : (
        <section className="practice-create-panel">
          <div className="practice-panel-heading"><p className="eyebrow">Add Secretary</p><h2>Add a regular Secretary</h2><p>Invite a new Secretary or identify an already-onboarded Secretary account.</p></div>
          {mode === 'none' ? <div className="button-row"><button className="primary" type="button" onClick={() => setMode('add')}>Add new Secretary</button><button className="secondary" type="button" onClick={() => setMode('replace-existing')}>Use existing Secretary</button></div> : null}
          {mode === 'add' ? <form className="practice-form" onSubmit={inviteNew}><div className="practice-form-grid"><label>First name<input required value={firstName} onChange={(e) => setFirstName(e.target.value)} /></label><label>Last name<input required value={lastName} onChange={(e) => setLastName(e.target.value)} /></label></div><label>Email<input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label><label>Mobile number<input required value={mobileNumber} onChange={(e) => setMobileNumber(e.target.value)} /></label><div className="button-row"><button className="primary" disabled={busy} type="submit">Send secure invitation</button><button className="secondary" type="button" onClick={() => setMode('none')}>Cancel</button></div></form> : null}
          {mode === 'replace-existing' ? <form className="practice-form" onSubmit={resolveExisting}><label>Existing Secretary email<input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label><div className="button-row"><button className="primary" disabled={busy} type="submit">Find existing Secretary</button><button className="secondary" type="button" onClick={() => setMode('none')}>Cancel</button></div></form> : null}
          {candidate ? <div className="practice-create-panel"><h3>{fullName(candidate.user)}</h3><p>{candidate.user.email} · {candidate.user.mobileNumber}</p><button className="primary" type="button" disabled={busy || !candidate.eligible} onClick={() => void assignOrReplace()}>Assign Secretary</button></div> : null}
        </section>
      )}
    </section>
  );
}
