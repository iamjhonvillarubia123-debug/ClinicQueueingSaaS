import { FormEvent, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ApiError, apiRequest } from '../api/client';
import { ClinicConfigurationTabs } from './ClinicConfigurationTabs';
import { SecretaryAccessSelector, SecretaryAccessSelection, standardSecretaryAccess } from './SecretaryAccessSelector';

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
type ReplacementInvitation = {
  id: string;
  status: 'PENDING' | 'ACCEPTED';
  firstName: string;
  lastName: string;
  normalizedEmail: string;
  mobileNumber: string;
  expiresAt: string;
  acceptedAt: string | null;
  acceptedUser: SecretaryUser | null;
  requestedAccess: SecretaryAccessSelection;
};
type StaffingMode = 'none' | 'add' | 'existing' | 'replace-existing' | 'replace-new' | 'manage-access' | 'remove';

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
function selectionFromCurrent(current: CurrentSecretary): SecretaryAccessSelection {
  const capabilities = new Set(current.capabilities.map((item) => item.capabilityType));
  return {
    accessProfile: current.accessProfile,
    canManageClinicDetails: current.canManageClinicDetails,
    canManageServices: current.canManageServices,
    canManageBookingQuestions: current.canManageBookingQuestions,
    canManageSchedules: current.canManageSchedules,
    cancelClinicDay: capabilities.has('CANCEL_CLINIC_DAY'),
    assignDaySecretary: capabilities.has('ASSIGN_DAY_SECRETARY'),
  };
}

export function SecretaryStaffingPage() {
  const { practiceLocationId } = useParams();
  const [staffing, setStaffing] = useState<Staffing | null>(null);
  const [replacementInvitations, setReplacementInvitations] = useState<ReplacementInvitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<StaffingMode>('none');
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
    try {
      const next = await apiRequest<Staffing>(`/practice-staff/regular/${encodeURIComponent(practiceLocationId)}`);
      setStaffing(next);
      if (next.regularSecretary) {
        setReplacementInvitations(await apiRequest<ReplacementInvitation[]>(`/secretary/replacement-invitations/location/${encodeURIComponent(practiceLocationId)}`));
      } else {
        setReplacementInvitations([]);
      }
    } catch (caught) { setError(errorMessage(caught)); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, [practiceLocationId]);

  function resetSelection() {
    setCandidate(null);
    setEmail('');
    setPassword('');
    setFirstName('');
    setLastName('');
    setMobileNumber('');
    setAccess({ ...standardSecretaryAccess });
  }
  function closeAction() { resetSelection(); setMode('none'); }

  async function resolveExisting(event: FormEvent) {
    event.preventDefault(); if (!practiceLocationId || busy) return;
    setBusy(true); setError(''); setCandidate(null);
    try {
      setCandidate(await apiRequest<ExistingResult>(`/practice-staff/regular/${encodeURIComponent(practiceLocationId)}/resolve-existing`, { method: 'POST', body: { email } }));
    } catch (caught) { setError(errorMessage(caught)); }
    finally { setBusy(false); }
  }

  async function configureAccess(userId: string, selectedAccess = access) {
    if (!practiceLocationId) return;
    await apiRequest('/practice-staff/regular/access', {
      method: 'POST', body: { practiceLocationId, userId, ...selectedAccess },
    });
  }

  async function saveCurrentAccess() {
    const current = staffing?.regularSecretary;
    if (!current || busy) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await configureAccess(current.user.id);
      setNotice('Secretary clinic access updated. Configuration changes remain subject to Doctor approval.');
      closeAction(); await load();
    } catch (caught) { setError(errorMessage(caught)); }
    finally { setBusy(false); }
  }

  async function assignExisting() {
    if (!practiceLocationId || !candidate?.eligible || busy) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await apiRequest('/practice-staff/regular/assign', {
        method: 'POST', headers: { 'Idempotency-Key': crypto.randomUUID() },
        body: { practiceLocationId, userId: candidate.user.id },
      });
      await configureAccess(candidate.user.id);
      setNotice('Existing Secretary assigned with the selected clinic access.');
      closeAction(); await load();
    } catch (caught) { setError(errorMessage(caught)); }
    finally { setBusy(false); }
  }

  async function replaceExisting() {
    if (!practiceLocationId || !candidate?.eligible || !password || busy) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await apiRequest('/practice-staff/regular/replace', {
        method: 'POST', headers: { 'Idempotency-Key': crypto.randomUUID() },
        body: { practiceLocationId, userId: candidate.user.id, password },
      });
      await configureAccess(candidate.user.id);
      setNotice('Regular Secretary replaced with the newly selected clinic access.');
      closeAction(); await load();
    } catch (caught) { setError(errorMessage(caught)); }
    finally { setBusy(false); }
  }

  async function removeSecretary() {
    if (!practiceLocationId || !staffing?.regularSecretary || !password || busy) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await apiRequest('/practice-staff/regular/remove', {
        method: 'POST', headers: { 'Idempotency-Key': crypto.randomUUID() },
        body: { practiceLocationId, password },
      });
      setNotice('Regular Secretary removed. The former Secretary no longer has current authority for this clinic.');
      closeAction(); await load();
    } catch (caught) { setError(errorMessage(caught)); }
    finally { setBusy(false); }
  }

  async function inviteInitial(event: FormEvent) {
    event.preventDefault(); if (!practiceLocationId || busy || staffing?.regularSecretary) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await apiRequest<InvitationResult>('/secretary/invitations', {
        method: 'POST', body: { practiceLocationId, firstName, lastName, email, mobileNumber, ...access },
      });
      if (result.outcome === 'EXISTING_SECRETARY') {
        setMode('existing');
        setCandidate({
          user: { id: result.secretaryUserId, firstName, middleName: null, lastName, email, mobileNumber, emailVerifiedAt: null, accountStatus: 'ACTIVE', administrativeRestrictionStatus: 'NONE' },
          eligible: result.eligibleForAssignment,
        });
        setNotice('That email already belongs to a Secretary account. Confirm the existing-account assignment below.');
      } else {
        setNotice('Secure Secretary invitation created with the selected clinic access. Access becomes active only after successful onboarding.');
        closeAction();
      }
    } catch (caught) { setError(errorMessage(caught)); }
    finally { setBusy(false); }
  }

  async function inviteReplacement(event: FormEvent) {
    event.preventDefault(); if (!practiceLocationId || busy || !staffing?.regularSecretary) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await apiRequest<InvitationResult>('/secretary/replacement-invitations', {
        method: 'POST', body: { practiceLocationId, firstName, lastName, email, mobileNumber, ...access },
      });
      if (result.outcome === 'EXISTING_SECRETARY') {
        setMode('replace-existing');
        setCandidate({
          user: { id: result.secretaryUserId, firstName, middleName: null, lastName, email, mobileNumber, emailVerifiedAt: null, accountStatus: 'ACTIVE', administrativeRestrictionStatus: 'NONE' },
          eligible: result.eligibleForAssignment,
        });
        setNotice('That email already belongs to a Secretary account. Confirm the existing-account replacement below.');
      } else {
        setNotice('Replacement invitation sent. The current Secretary remains in control until onboarding finishes and you confirm replacement.');
        closeAction(); await load();
      }
    } catch (caught) { setError(errorMessage(caught)); }
    finally { setBusy(false); }
  }

  async function confirmReadyReplacement(invitation: ReplacementInvitation) {
    if (!practiceLocationId || !invitation.acceptedUser || !password || busy) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await apiRequest('/practice-staff/regular/replace', {
        method: 'POST', headers: { 'Idempotency-Key': crypto.randomUUID() },
        body: { practiceLocationId, userId: invitation.acceptedUser.id, password },
      });
      await configureAccess(invitation.acceptedUser.id, invitation.requestedAccess);
      setNotice('Replacement completed. The outgoing Secretary lost this clinic authority and the incoming Secretary received the selected access.');
      setPassword(''); setMode('none'); await load();
    } catch (caught) { setError(errorMessage(caught)); }
    finally { setBusy(false); }
  }

  if (loading) return <section className="practice-admin-page"><p className="practice-muted">Loading clinic staff…</p></section>;
  if (!practiceLocationId || !staffing) return <section className="practice-admin-page"><div className="form-error" role="alert">{error || 'Clinic staffing was not found.'}</div></section>;
  const current = staffing.regularSecretary;
  const secretary = current?.user ?? null;
  const capabilitySet = new Set(current?.capabilities.map((item) => item.capabilityType) ?? []);
  const readyReplacement = replacementInvitations.find((item) => item.status === 'ACCEPTED' && item.acceptedUser);
  const pendingReplacement = replacementInvitations.find((item) => item.status === 'PENDING');

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
          {current ? <><div className="staff-authority-list">
            <div className="staff-authority-row"><span>Queue & ordinary clinic-day operations</span><strong>Standard</strong></div>
            <div className="staff-authority-row"><span>Clinic details</span><strong>{current.canManageClinicDetails ? 'May propose' : 'Not granted'}</strong></div>
            <div className="staff-authority-row"><span>Services</span><strong>{current.canManageServices ? 'May propose' : 'Not granted'}</strong></div>
            <div className="staff-authority-row"><span>Booking questions</span><strong>{current.canManageBookingQuestions ? 'May propose' : 'Not granted'}</strong></div>
            <div className="staff-authority-row"><span>Clinic schedules</span><strong>{current.canManageSchedules ? 'May propose' : 'Not granted'}</strong></div>
            <div className="staff-authority-row"><span>Assign day Secretary</span><strong>{capabilitySet.has('ASSIGN_DAY_SECRETARY') ? 'Granted' : 'Not granted'}</strong></div>
            <div className="staff-authority-row"><span>Cancel entire clinic day</span><strong>{capabilitySet.has('CANCEL_CLINIC_DAY') ? 'Granted' : 'Not granted'}</strong></div>
          </div><button className="secondary" type="button" onClick={() => { setAccess(selectionFromCurrent(current)); setMode('manage-access'); }}>Change access</button></> : <p className="practice-muted">Choose access when adding the clinic's Secretary.</p>}
        </section>
      </div>

      {current && readyReplacement ? <section className="practice-create-panel"><div className="practice-panel-heading"><p className="eyebrow">Replacement ready</p><h2>{fullName(readyReplacement.acceptedUser!)}</h2><p>The candidate completed account onboarding but has no authority over this clinic yet. Confirming below performs the actual handoff.</p></div><div className="staff-authority-list"><div className="staff-authority-row"><span>Selected access</span><strong>{profileLabel(readyReplacement.requestedAccess.accessProfile)}</strong></div><div className="staff-authority-row"><span>Email</span><strong>{readyReplacement.acceptedUser!.email}</strong></div></div><label>Current Doctor password<input aria-label="Current Doctor password for ready replacement" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></label><button className="primary" type="button" disabled={busy || !password} onClick={() => void confirmReadyReplacement(readyReplacement)}>Confirm Secretary replacement</button></section> : null}
      {current && pendingReplacement && !readyReplacement ? <div className="practice-notice"><strong>Replacement onboarding pending.</strong> {pendingReplacement.firstName} {pendingReplacement.lastName} has been invited. The current Secretary remains fully authorized until the candidate completes onboarding and you confirm replacement.</div> : null}

      {current && mode === 'manage-access' ? <section className="practice-create-panel"><div className="practice-panel-heading"><p className="eyebrow">Change access</p><h2>Update {fullName(current.user)}'s clinic access</h2><p>Changing configuration access does not make Secretary proposals effective. Doctor approval is still required.</p></div><SecretaryAccessSelector value={access} onChange={setAccess} /><div className="button-row"><button className="primary" type="button" disabled={busy} onClick={() => void saveCurrentAccess()}>Save access</button><button className="secondary" type="button" onClick={closeAction}>Cancel</button></div></section> : null}

      {secretary ? (
        <section className="practice-create-panel">
          <div className="practice-panel-heading"><p className="eyebrow">Secretary lifecycle</p><h2>Replace or remove the current regular Secretary</h2><p>Replacement never inherits optional authority from the outgoing Secretary. Replacement and removal require the Doctor's current password at the actual authority-change step.</p></div>
          {mode === 'none' ? <div className="button-row"><button className="primary" type="button" onClick={() => { resetSelection(); setMode('replace-existing'); }}>Replace Secretary</button><button className="secondary" type="button" onClick={() => { resetSelection(); setMode('remove'); }}>Remove Secretary</button></div> : null}
          {mode === 'replace-existing' || mode === 'replace-new' ? <div className="clinic-replacement-choices"><button className={mode === 'replace-existing' ? 'primary' : 'secondary'} type="button" onClick={() => { resetSelection(); setMode('replace-existing'); }}>Existing Secretary</button><button className={mode === 'replace-new' ? 'primary' : 'secondary'} type="button" onClick={() => { resetSelection(); setMode('replace-new'); }}>New Secretary</button><button className="secondary" type="button" onClick={closeAction}>Cancel</button></div> : null}
          {mode === 'replace-existing' ? <><form className="practice-form" onSubmit={resolveExisting}><label>Existing Secretary email<input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label><button className="secondary" disabled={busy || !email.trim()} type="submit">Find existing Secretary</button></form>{candidate ? <><SecretaryAccessSelector value={access} onChange={setAccess} /><div className="practice-create-panel"><h3>{fullName(candidate.user)}</h3><p>{candidate.user.email} · {candidate.user.mobileNumber}</p><p>{candidate.eligible ? 'Eligible for replacement' : 'Not currently eligible for replacement'}</p><label>Current Doctor password<input aria-label="Current Doctor password for replacement" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></label><button className="primary" type="button" disabled={busy || !candidate.eligible || !password} onClick={() => void replaceExisting()}>Confirm replacement</button></div></> : null}</> : null}
          {mode === 'replace-new' ? <form className="practice-form" onSubmit={inviteReplacement}><div className="practice-form-grid"><label>First name<input required value={firstName} onChange={(e) => setFirstName(e.target.value)} /></label><label>Last name<input required value={lastName} onChange={(e) => setLastName(e.target.value)} /></label></div><label>Email<input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label><label>Mobile number<input required value={mobileNumber} onChange={(e) => setMobileNumber(e.target.value)} /></label><SecretaryAccessSelector value={access} onChange={setAccess} /><div className="practice-notice">Sending this invitation does not replace the current Secretary. The candidate must finish onboarding first, then the Doctor confirms the handoff with the current password.</div><button className="primary" disabled={busy} type="submit">Send replacement invitation</button></form> : null}
          {mode === 'remove' ? <div className="practice-form"><div className="practice-notice">Removing the regular Secretary immediately removes current authority for this clinic. It does not delete the Secretary's account or assignments to other clinics.</div><label>Current Doctor password<input aria-label="Current Doctor password for removal" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></label><div className="button-row"><button className="primary" type="button" disabled={busy || !password} onClick={() => void removeSecretary()}>Confirm removal</button><button className="secondary" type="button" onClick={closeAction}>Cancel</button></div></div> : null}
        </section>
      ) : (
        <section className="practice-create-panel">
          <div className="practice-panel-heading"><p className="eyebrow">Add Secretary</p><h2>Add a regular Secretary</h2><p>Choose the clinic access before sending the invitation or assigning an existing Secretary.</p></div>
          {mode === 'none' ? <div className="button-row"><button className="primary" type="button" onClick={() => { resetSelection(); setMode('add'); }}>Add new Secretary</button><button className="secondary" type="button" onClick={() => { resetSelection(); setMode('existing'); }}>Use existing Secretary</button></div> : null}
          {mode === 'add' ? <form className="practice-form" onSubmit={inviteInitial}><div className="practice-form-grid"><label>First name<input required value={firstName} onChange={(e) => setFirstName(e.target.value)} /></label><label>Last name<input required value={lastName} onChange={(e) => setLastName(e.target.value)} /></label></div><label>Email<input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label><label>Mobile number<input required value={mobileNumber} onChange={(e) => setMobileNumber(e.target.value)} /></label><SecretaryAccessSelector value={access} onChange={setAccess} /><div className="button-row"><button className="primary" disabled={busy} type="submit">Send secure invitation</button><button className="secondary" type="button" onClick={closeAction}>Cancel</button></div></form> : null}
          {mode === 'existing' ? <><form className="practice-form" onSubmit={resolveExisting}><label>Existing Secretary email<input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label><div className="button-row"><button className="primary" disabled={busy} type="submit">Find existing Secretary</button><button className="secondary" type="button" onClick={closeAction}>Cancel</button></div></form>{candidate ? <><SecretaryAccessSelector value={access} onChange={setAccess} /><div className="practice-create-panel"><h3>{fullName(candidate.user)}</h3><p>{candidate.user.email} · {candidate.user.mobileNumber}</p><button className="primary" type="button" disabled={busy || !candidate.eligible} onClick={() => void assignExisting()}>Assign Secretary</button></div></> : null}</> : null}
        </section>
      )}
    </section>
  );
}
