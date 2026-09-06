import { useMemo, useState } from 'react';
import type { AuthoritativeClinicStaff } from './AuthoritativeClinicStaffTab';

export const AUTHORITY_BUNDLES = [
  ['QUEUE_AND_CLINIC_DAY_OPERATIONS', 'Queue & Clinic Day Operations'],
  ['APPOINTMENTS_AND_PATIENT_INTAKE', 'Appointments & Patient Intake'],
  ['CLINIC_CONFIGURATION_DRAFTING', 'Clinic Configuration Drafting'],
  ['REPORTS_VIEW_ONLY', 'Reports · View Only'],
] as const;

const AUTHORITY_BUNDLE_DETAILS: Record<string, string[]> = {
  QUEUE_AND_CLINIC_DAY_OPERATIONS: ['Delayed Opening', 'Start Clinic', 'Call Again', 'Next Patient', 'Staff Reinsert', 'Return to Queue', 'Undo', 'Close Clinic'],
  APPOINTMENTS_AND_PATIENT_INTAKE: ['Add Walk-in / Appointment'],
  CLINIC_CONFIGURATION_DRAFTING: ['Prepare Draft', 'Edit Draft', 'Submit for Doctor Approval'],
  REPORTS_VIEW_ONLY: ['View Reports'],
};

export type StaffAssignmentCommand =
  | { role: 'CLINIC_SECRETARY'; userId: string; firstName: string; lastName: string; email: string; mobileNumber: string; authorityBundles: string[]; requestedCancelClinicDay: boolean; password?: string }
  | { role: 'SUBSTITUTE_SECRETARY'; userId: string; firstName: string; lastName: string; email: string; mobileNumber: string; coverageMode: 'ONE_SERVICE_DATE' | 'DATE_RANGE'; fromServiceDate: string; toServiceDate: string }
  | { role: 'INVITE_NEW'; identifier: string; assignmentType: 'CLINIC_SECRETARY'; authorityBundles: string[]; requestedCancelClinicDay: boolean; password?: string }
  | { role: 'INVITE_NEW'; identifier: string; assignmentType: 'SUBSTITUTE_SECRETARY'; coverageMode: 'ONE_SERVICE_DATE' | 'DATE_RANGE'; fromServiceDate: string; toServiceDate: string };

export function StaffAssignmentDrawer({ data, pending, message, onClose, onSubmit }: {
  data: AuthoritativeClinicStaff;
  pending: boolean;
  message: string;
  onClose: () => void;
  onSubmit: (command: StaffAssignmentCommand) => void | Promise<void>;
}) {
  const current = data.staffAssignments.find((staff) => staff.isClinicSecretary && staff.assignmentActive);
  const candidates = useMemo(() => data.candidates.filter((candidate) => candidate.userId !== current?.userId), [current?.userId, data.candidates]);
  const [step, setStep] = useState(1);
  const [mode, setMode] = useState<'EXISTING' | 'INVITE'>('EXISTING');
  const [userId, setUserId] = useState(candidates[0]?.userId ?? '');
  const [candidateSearch, setCandidateSearch] = useState('');
  const [role, setRole] = useState<'CLINIC_SECRETARY' | 'SUBSTITUTE_SECRETARY'>('CLINIC_SECRETARY');
  const [bundles, setBundles] = useState<string[]>([AUTHORITY_BUNDLES[0][0]]);
  const [expandedBundle, setExpandedBundle] = useState<string | null>(null);
  const [cancelClinicDay, setCancelClinicDay] = useState(false);
  const [coverageMode, setCoverageMode] = useState<'ONE_SERVICE_DATE' | 'DATE_RANGE'>('ONE_SERVICE_DATE');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [password, setPassword] = useState('');
  const [inviteIdentifier, setInviteIdentifier] = useState('');
  const selected = candidates.find((candidate) => candidate.userId === userId);
  const visibleCandidates = useMemo(() => {
    const query = candidateSearch.trim().toLowerCase();
    if (!query) return candidates;
    return candidates.filter((candidate) => [candidate.name, candidate.email, candidate.mobileNumber].some((value) => value.toLowerCase().includes(query)));
  }, [candidateSearch, candidates]);
  const selectedName = mode === 'INVITE' ? 'this Secretary' : selected?.name;
  const detailsValid = Boolean(inviteIdentifier.trim());
  const configurationValid = role === 'CLINIC_SECRETARY'
    ? bundles.length > 0 && (!current && !cancelClinicDay ? true : password.length > 0)
    : Boolean(fromDate && toDate && fromDate <= toDate && (coverageMode !== 'ONE_SERVICE_DATE' || fromDate === toDate));
  const messageIsError = Boolean(message && !message.toLowerCase().includes('successfully'));
  const identifierCorrectionVisible = Boolean(
    mode === 'INVITE' &&
    step === 5 &&
    messageIsError &&
    (message.toLowerCase().includes('secretary account') ||
      message.toLowerCase().includes('mobile number') ||
      message.toLowerCase().includes('email address')),
  );
  const toggleBundle = (bundle: string) => setBundles((value) => value.includes(bundle) ? value.filter((item) => item !== bundle) : [...value, bundle]);

  function submit() {
    if (mode === 'INVITE') {
      const identifier = inviteIdentifier.trim();
      void onSubmit(role === 'CLINIC_SECRETARY'
        ? { role: 'INVITE_NEW', identifier, assignmentType: role, authorityBundles: bundles, requestedCancelClinicDay: cancelClinicDay, password: current || cancelClinicDay ? password : undefined }
        : { role: 'INVITE_NEW', identifier, assignmentType: role, coverageMode, fromServiceDate: fromDate, toServiceDate: toDate });
    } else if (selected) {
      const [firstName, ...lastNameParts] = selected.name.trim().split(/\s+/);
      const identity = { firstName, lastName: lastNameParts.join(' ') || firstName, email: selected.email, mobileNumber: selected.mobileNumber };
      void onSubmit(role === 'CLINIC_SECRETARY'
        ? { role, userId: selected.userId, ...identity, authorityBundles: bundles, requestedCancelClinicDay: cancelClinicDay, password: current || cancelClinicDay ? password : undefined }
        : { role, userId: selected.userId, ...identity, coverageMode, fromServiceDate: fromDate, toServiceDate: toDate });
    }
  }

  return (
    <aside className="staff-assignment-drawer" aria-label="Assign Secretary drawer">
      <button type="button" className="staff-drawer-close" aria-label="Close Assign Secretary drawer" onClick={onClose}>×</button>
      <span className="staff-drawer-step">{step}</span>
      {step === 1 ? <><h2>Assign Secretary</h2><p>Choose how you want to add or assign a Secretary to {data.clinic.name}.</p><button type="button" className="staff-choice-card is-selected" onClick={() => { setMode('EXISTING'); setStep(2); }}><b>Assign Existing Secretary</b><span>Assign a Secretary who already has an account in the system.</span></button><button type="button" className="staff-choice-card" aria-label="Invite New Secretary to Clinic" onClick={() => { setMode('INVITE'); setStep(2); }}><b>Invite Secretary to Clinic</b><span>Send a clinic invitation to an existing Secretary account.</span></button></> : null}
      {step === 2 && mode === 'EXISTING' ? <><h2>Assign Existing Secretary</h2><p>Select a Secretary to assign to {data.clinic.name}.</p><label className="staff-candidate-search">Search your existing Secretaries<input type="search" placeholder="Search by name, email or mobile…" value={candidateSearch} onChange={(event) => setCandidateSearch(event.target.value)} /></label><div className="staff-candidate-list">{visibleCandidates.length ? visibleCandidates.map((candidate) => <button type="button" key={candidate.userId} className={userId === candidate.userId ? 'is-selected' : ''} onClick={() => setUserId(candidate.userId)}><i aria-hidden="true" /><span><strong>{candidate.name}</strong><small>{candidate.email}</small><small>{candidate.mobileNumber}</small></span></button>) : <p>{candidateSearch.trim() ? 'No existing Secretary relationships match your search.' : 'No eligible existing Secretaries are available.'}</p>}</div></> : null}
      {step === 2 && mode === 'INVITE' ? <><h2>Invitation Details</h2><p>Enter the Secretary's registered mobile number or email address. The Secretary must already have an active, verified Secretary account.</p><div className="staff-invite-fields"><label>Secretary mobile # or email address<input type="text" autoComplete="off" placeholder="Enter mobile # or email address" value={inviteIdentifier} onChange={(event) => setInviteIdentifier(event.target.value)} /></label></div></> : null}
      {step === 3 ? <><h2>Set Assignment Type</h2><p>Choose the type of assignment for {selectedName}.</p><button type="button" className={`staff-choice-card ${role === 'CLINIC_SECRETARY' ? 'is-selected' : ''}`} onClick={() => setRole('CLINIC_SECRETARY')}><b>Clinic Secretary</b><span>Assign as the Clinic Secretary for {data.clinic.name}.</span></button><button type="button" className={`staff-choice-card ${role === 'SUBSTITUTE_SECRETARY' ? 'is-selected' : ''}`} onClick={() => setRole('SUBSTITUTE_SECRETARY')}><b>Substitute Secretary</b><span>Temporary coverage with live clinic and queue authority only during covered dates.</span></button></> : null}
      {step === 4 && role === 'CLINIC_SECRETARY' ? <><h2>Set Authority Bundles</h2><p>Select one or more authority bundles.</p><div className="staff-bundle-list">{AUTHORITY_BUNDLES.map(([value, label]) => { const expanded = expandedBundle === value; return <div className="staff-bundle-item" key={value}><div className="staff-bundle-row"><label><input type="checkbox" checked={bundles.includes(value)} onChange={() => toggleBundle(value)} /><strong>{label}</strong></label><button type="button" className="staff-bundle-expand" aria-expanded={expanded} aria-label={`${expanded ? 'Hide' : 'Show'} ${label} authority`} onClick={() => setExpandedBundle(expanded ? null : value)}>{expanded ? '⌃' : '⌄'}</button></div>{expanded ? <div className="staff-bundle-details">{AUTHORITY_BUNDLE_DETAILS[value].map((detail) => <span key={detail}><b aria-hidden="true" style={{ color: '#168337', marginRight: 6 }}>✓</b>{detail}</span>)}</div> : null}</div>; })}</div><label className="staff-radio"><input type="checkbox" checked={cancelClinicDay} onChange={(event) => setCancelClinicDay(event.target.checked)} /> Allow Cancel Clinic Day <small>Sensitive authority requiring Doctor re-authentication when used.</small></label>{current ? <div className="staff-replacement-warning"><strong>Replace current Clinic Secretary?</strong><p>{mode === 'INVITE' ? `If this invitation is accepted, the invited Secretary will replace ${current.name} at ${data.clinic.name}.` : `${selectedName} will replace ${current.name} at ${data.clinic.name} when you confirm this assignment.`} {current.name}'s account and unrelated clinic assignments remain unaffected.</p><label>Enter your current password to authorize this replacement<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} /></label></div> : cancelClinicDay ? <div className="staff-replacement-warning"><strong>Sensitive authority</strong><p>Cancel Clinic Day can interrupt clinic operations and requires fresh Doctor authentication before it is granted.</p><label>Enter your current password to grant Cancel Clinic Day<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} /></label></div> : null}</> : null}
      {step === 4 && role === 'SUBSTITUTE_SECRETARY' ? <><h2>Substitute Secretary Coverage</h2><p>Select the inclusive coverage period for {selectedName}.</p><label className="staff-radio"><input type="radio" checked={coverageMode === 'ONE_SERVICE_DATE'} onChange={() => { setCoverageMode('ONE_SERVICE_DATE'); setToDate(fromDate); }} /> One Clinic Day</label><label className="staff-radio"><input type="radio" checked={coverageMode === 'DATE_RANGE'} onChange={() => setCoverageMode('DATE_RANGE')} /> Date Range</label><div className="staff-date-fields"><label>From<input type="date" value={fromDate} onChange={(event) => { setFromDate(event.target.value); if (coverageMode === 'ONE_SERVICE_DATE') setToDate(event.target.value); }} /></label><label>To<input type="date" disabled={coverageMode === 'ONE_SERVICE_DATE'} value={toDate} onChange={(event) => setToDate(event.target.value)} /></label></div><div className="staff-neutral-note">Authority is fixed and limited to live clinic and queue operations on covered Clinic Days. The Clinic Secretary remains assigned.</div></> : null}
      {step === 5 ? <><h2>{mode === 'INVITE' ? 'Review Invitation' : 'Review Assignment'}</h2><p>{mode === 'INVITE' ? 'Please review the pending clinic relationship invitation.' : 'Please review the clinic-scoped Secretary assignment.'}</p><dl className="staff-review">{mode === 'INVITE' ? <div><dt>Secretary mobile # or email</dt><dd>{inviteIdentifier.trim()}</dd></div> : <div><dt>Secretary</dt><dd>{selectedName}</dd></div>}<div><dt>Clinic</dt><dd>{data.clinic.name}</dd></div><div><dt>Assignment Type</dt><dd>{role === 'CLINIC_SECRETARY' ? 'Clinic Secretary' : 'Substitute Secretary'}</dd></div>{role === 'CLINIC_SECRETARY' ? <div><dt>Authority Bundles</dt><dd>{bundles.map((bundle) => AUTHORITY_BUNDLES.find(([value]) => value === bundle)?.[1]).join(', ')}</dd></div> : <div><dt>Coverage Period</dt><dd>{fromDate} – {toDate}</dd></div>}</dl><div className="staff-neutral-note">{mode === 'INVITE' ? 'The system will match this identifier to an existing active, verified Secretary account. No clinic authority is granted until that Secretary accepts.' : role === 'CLINIC_SECRETARY' ? "This creates or reactivates the clinic-scoped relationship immediately. Today's ClinicDay operating Secretary remains a separate assignment." : 'Coverage authority is limited to the selected Service Date period and does not grant Clinic Secretary authority bundles.'}</div></> : null}
      {message ? <div className={`staff-drawer-message${messageIsError ? ' is-error' : ''}`} role={messageIsError ? 'alert' : 'status'}>{message}</div> : null}
      {identifierCorrectionVisible ? <div className="staff-invite-fields"><label>Secretary mobile # or email address<input type="text" value={inviteIdentifier} onChange={(event) => setInviteIdentifier(event.target.value)} /></label><button type="button" className="clinic-staff-primary-button is-full" disabled={pending || !inviteIdentifier.trim()} onClick={submit}>{pending ? 'Retrying…' : 'Retry Invitation'}</button></div> : null}
      <footer><button type="button" onClick={step === 1 ? onClose : () => setStep((value) => value - 1)}>{step === 1 ? 'Cancel' : 'Back'}</button>{step < 5 ? <button type="button" className="is-primary" disabled={(step === 2 && (mode === 'EXISTING' ? !userId : !detailsValid)) || (step === 4 && !configurationValid)} onClick={() => setStep((value) => value + 1)}>Next</button> : !identifierCorrectionVisible ? <button type="button" className="is-primary" disabled={pending} onClick={submit}>{pending ? mode === 'INVITE' ? 'Sending…' : 'Assigning…' : mode === 'INVITE' ? 'Send Invitation' : current && role === 'CLINIC_SECRETARY' ? 'Replace Secretary' : 'Assign Secretary'}</button> : null}</footer>
    </aside>
  );
}
