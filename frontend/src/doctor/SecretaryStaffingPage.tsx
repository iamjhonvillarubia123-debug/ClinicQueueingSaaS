import { FormEvent, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ApiError, apiRequest } from '../api/client';
import { ClinicConfigurationTabs } from './ClinicConfigurationTabs';
import {
  SecretaryAccessSelector,
  SecretaryAccessSelection,
  standardSecretaryAccess,
} from './SecretaryAccessSelector';

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
type CurrentSecretary = {
  id: string;
  isActive: boolean;
  createdAt: string;
  accessProfile: SecretaryAccessSelection['accessProfile'];
  canManageClinicDetails: boolean;
  canManageServices: boolean;
  canManageBookingQuestions: boolean;
  canManageSchedules: boolean;
  capabilities: Array<{ capabilityType: 'CANCEL_CLINIC_DAY' | 'ASSIGN_DAY_SECRETARY' }>;
  user: SecretaryUser;
};
type Staffing = {
  location: { id: string; name: string | null; lifecycleStatus: string; currentRegularPracticeStaffId: string | null };
  regularSecretary: CurrentSecretary | null;
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
function profileLabel(profile: SecretaryAccessSelection['accessProfile']) {
  if (profile === 'FULL_CLINIC_CONFIGURATION') return 'Full clinic configuration';
  if (profile === 'CUSTOM') return 'Custom';
  return 'Standard';
}

export function SecretaryStaffingPage() {
  const { practiceLocationId } = useParams();
  const [staffing, setStaffing] = useState<Staffing | null>(null);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<'none' | 'add' | 'replace-existing' | 'replace-new'>('none');
  const [email, setEmail] = useState('');
  const [candidate, setCandidate] = useState<ExistingResult | null>(null);
  const [password, setPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [mobileNumber, setMobileNumber] = useState('');
  const [access, setAccess] = useState<SecretaryAccessSelection>({ ...standardSecretaryAccess });
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

  function resetSelection() {
    setCandidate(null); setEmail(''); setPassword(''); setAccess({ ...standardSecretaryAccess });
  }

  async function resolveExisting(event: FormEvent) {
    event.preventDefault(); if (!practiceLocationId || busy) return;
    setBusy(true); setError(''); setCandidate(null);
    try {
      setCandidate(await apiRequest<ExistingResult>(`/practice-staff/regular/${encodeURIComponent(practiceLocationId)}/resolve-existing`, { method: 'POST', body: { email } }));
    } catch (caught) { setError(errorMessage(caught)); }
    finally { setBusy(false); }
  }

  async function configureAccess(userId: string) {
    if (!practiceLocationId) return;
    await apiRequest('/practice-staff/regular/access', {
      method: 'POST',
      body: { practiceLocationId, userId, ...access },
    });
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
        await configureAccess(candidate.user.id);
        setNotice('Regular Secretary replaced with the selected clinic access.');
      } else {
        await apiRequest('/practice-staff/regular/assign', {
          method: 'POST', headers: { 'Idempotency-Key': crypto.randomUUID() },
          body: { practiceLocationId, userId: candidate.user.id },
        });
        await configureAccess(candidate.user.id);
        setNotice('Existing Secretary assigned with the selected clinic access.');
      }
      setMode('none'); resetSelection(); await load();
    } catch (caught) { setError(errorMessage(caught)); }
    finally { setBusy(false); }
  }

  async function inviteNew(event: FormEvent) {
    event.preventDefault(); if (!practiceLocationId || busy || staffing?.regularSecretary) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await apiRequest<InvitationResult>('/secretary/invitations', {
        method: 'POST',
        body: { practiceLocationId, firstName, lastName, email, mobileNumber, ...access },
      });
      if (result.outcome === 'EXISTING_SECRETARY') {
        setMode('add');
        setCandidate({
          user: {
            id: result.secretaryUserId, firstName, middleName: null, lastName, email, mobileNumber,
            emailVerifiedAt: null, accountStatus: 'ACTIVE', administrativeRestrictionStatus: 'NONE',
          },
          eligible: result.eligibleForAssignment,
        });
        setNotice('That email already belongs to a Secretary account. Confirm the existing-account assignment below.');
      } else {
        setNotice('Secure Secretary invitation created with the selected clinic access. Access becomes active only after successful onboarding.');
        setMode('none'); setFirstName(''); setLastName(''); setEmail(''); setMobileNumber(''); setAccess({ ...standardSecretaryAccess });
      }
    } catch (caught) { setError(errorMessage(caught)); }
    finally { setBusy(false); }
  }

  if (loading) return <section className="practice-admin-page"><p className="practice-muted">Loading clinic staff…</p></section>;
  if (!practiceLocationId || !staffing) return <section className="practice-admin-page"><div className="form-error" role="alert">{error || 'Clinic staffing was not found.'}</div></section>;
  const current = staffing.regularSecretary;
  const secretary = current?.user ?? null;
  const capabilitySet = new Set(current?.capabilities.map((item) => item.capabilityType) ?? []);

  return (
    <section className="practice-admin-page" aria-labelledby="clinic-staff-heading">
      <div className="practice-admin-heading"><div><p className="eyebrow">Clinic configuration</p><h1 id="clinic-staff-heading">{staffing.location.name || 'Clinic'} staff</h1><p>Manage the current regular Secretary and the clinic-specific authority attached to this assignment.</p></div><Link className="secondary-action" to="/app/practice-locations">← Back to clinic locations</Link></div>
      <ClinicConfigurationTabs practiceLocationId={practiceLocationId} active="staff" />
      {error ? <div className="form-error" role="alert">{error}</div> : null}
      {notice ? <div className="practice-notice practice-success" role="status">{notice}</div> : null}

      <div className="clinic-staff-grid">
        <section className="practice-create-panel">
          <div className="practice-panel-heading"><p className="eyebrow">Assigned Secretary</p><h2>{secretary ? fullName(secretary) : 'No regular Secretary'}</h2></div>
          {secretary ? <div className="staff-identity"><p><strong>{secretary.email}</strong></p><p>{secretary.mobileNumber}</p><p>{secretary.emailVerifiedAt ? 'Email verified' : 'Email verification incomplete'} · {current?.isActive ? 'Assignment active' : 'Assignment inactive'}</p><p className="practice-muted">Assigned {new Date(current!.createdAt).toLocaleDateString()}</p></div> : <p className="practice-muted">The Doctor currently manages this clinic without a regular Secretary.</p>}
        </section>

        <section className="practice-create-panel">
          <div className="practice-panel-heading"><p className="eyebrow">Secretary authority</p><h2>{current ? profileLabel(current.accessProfile) : 'No access profile'}</h2><p>Standard operations are direct. Configuration changes outside Standard remain proposals until Doctor approval.</p></div>
          {current ? <div className="staff-authority-list">
            <div className="staff-authority-row"><span>Queue & ordinary clinic-day operations</span><strong>Standard</strong></div>
            <div className="staff-authority-row"><span>Clinic details</span><strong>{current.canManageClinicDetails ? 'May propose' : 'Not granted'}</strong></div>
            <div className="staff-authority-row"><span>Services</span><strong>{current.canManageServices ? 'May propose' : 'Not granted'}</strong></div>
            <div className="staff-authority-row"><span>Booking questions</span><strong>{current.canManageBookingQuestions ? 'May propose' : 'Not granted'}</strong></div>
            <div className="staff-authority-row"><span>Clinic schedules</span><strong>{current.canManageSchedules ? 'May propose' : 'Not granted'}</strong></div>
            <div className="staff-authority-row"><span>Assign day Secretary</span><strong>{capabilitySet.has('ASSIGN_DAY_SECRETARY') ? 'Granted' : 'Not granted'}</strong></div>
            <div className="staff-authority-row"><span>Cancel entire clinic day</span><strong>{capabilitySet.has('CANCEL_CLINIC_DAY') ? 'Granted' : 'Not granted'}</strong></div>
          </div> : <p className="practice-muted">Choose access when adding the clinic's Secretary.</p>}
        </section>
      </div>

      {secretary ? (
        <section className="practice-create-panel">
          <div className="practice-panel-heading"><p className="eyebrow">Change Secretary</p><h2>Replace the current regular Secretary</h2><p>The incoming Secretary starts from Standard access and never inherits the outgoing Secretary's optional authority. Replacement requires the Doctor's current password.</p></div>
          {mode === 'none' ? <button className="primary" type="button" onClick={() => { resetSelection(); setMode('replace-existing'); }}>Replace Secretary</button> : null}
          {mode === 'replace-existing' || mode === 'replace-new' ? <div className="clinic-replacement-choices"><button className={mode === 'replace-existing' ? 'primary' : 'secondary'} type="button" onClick={() => { resetSelection(); setMode('replace-existing'); }}>Existing Secretary</button><button className={mode === 'replace-new' ? 'primary' : 'secondary'} type="button" onClick={() => { resetSelection(); setMode('replace-new'); }}>New Secretary</button><button className="secondary" type="button" onClick={() => { resetSelection(); setMode('none'); }}>Cancel</button></div> : null}
          {mode === 'replace-existing' ? <><form className="practice-form" onSubmit={resolveExisting}><label>Existing Secretary email<input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label><button className="secondary" disabled={busy || !email.trim()} type="submit">Find existing Secretary</button></form>{candidate ? <><SecretaryAccessSelector value={access} onChange={setAccess} /><div className="practice-create-panel"><h3>{fullName(candidate.user)}</h3><p>{candidate.user.email} · {candidate.user.mobileNumber}</p><p>{candidate.eligible ? 'Eligible for replacement' : 'Not currently eligible for replacement'}</p><label>Current Doctor password<input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></label><button className="primary" type="button" disabled={busy || !candidate.eligible || !password} onClick={() => void assignOrReplace()}>Confirm replacement</button></div></> : null}</> : null}
          {mode === 'replace-new' ? <div className="practice-notice"><strong>New-person replacement onboarding is the next protected handoff step.</strong><p>The incoming person must complete onboarding without receiving clinic authority until the Doctor performs the password-confirmed replacement. The current Secretary remains active until then.</p></div> : null}
        </section>
      ) : (
        <section className="practice-create-panel">
          <div className="practice-panel-heading"><p className="eyebrow">Add Secretary</p><h2>Add a regular Secretary</h2><p>Choose the clinic access before sending the invitation or assigning an existing Secretary.</p></div>
          {mode === 'none' ? <div className="button-row"><button className="primary" type="button" onClick={() => { resetSelection(); setMode('add'); }}>Add new Secretary</button><button className="secondary" type="button" onClick={() => { resetSelection(); setMode('replace-existing'); }}>Use existing Secretary</button></div> : null}
          {mode === 'add' ? <form className="practice-form" onSubmit={inviteNew}><div className="practice-form-grid"><label>First name<input required value={firstName} onChange={(e) => setFirstName(e.target.value)} /></label><label>Last name<input required value={lastName} onChange={(e) => setLastName(e.target.value)} /></label></div><label>Email<input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label><label>Mobile number<input required value={mobileNumber} onChange={(e) => setMobileNumber(e.target.value)} /></label><SecretaryAccessSelector value={access} onChange={setAccess} /><div className="button-row"><button className="primary" disabled={busy} type="submit">Send secure invitation</button><button className="secondary" type="button" onClick={() => { resetSelection(); setMode('none'); }}>Cancel</button></div></form> : null}
          {mode === 'replace-existing' ? <><form className="practice-form" onSubmit={resolveExisting}><label>Existing Secretary email<input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label><div className="button-row"><button className="primary" disabled={busy} type="submit">Find existing Secretary</button><button className="secondary" type="button" onClick={() => { resetSelection(); setMode('none'); }}>Cancel</button></div></form>{candidate ? <><SecretaryAccessSelector value={access} onChange={setAccess} /><div className="practice-create-panel"><h3>{fullName(candidate.user)}</h3><p>{candidate.user.email} · {candidate.user.mobileNumber}</p><button className="primary" type="button" disabled={busy || !candidate.eligible} onClick={() => void assignOrReplace()}>Assign Secretary</button></div></> : null}</> : null}
        </section>
      )}
    </section>
  );
}
