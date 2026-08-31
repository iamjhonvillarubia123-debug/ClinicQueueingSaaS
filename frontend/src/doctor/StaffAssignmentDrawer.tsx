import { useMemo, useState } from 'react';
import type { AuthoritativeClinicStaff } from './AuthoritativeClinicStaffTab';

export const AUTHORITY_BUNDLES = [
  ['QUEUE_AND_CLINIC_DAY_OPERATIONS', 'Queue & Clinic Day Operations'],
  ['APPOINTMENTS_AND_PATIENT_INTAKE', 'Appointments & Patient Intake'],
  ['CLINIC_CONFIGURATION_DRAFTING', 'Clinic Configuration Drafting'],
  ['REPORTS_VIEW_ONLY', 'Reports · View Only'],
] as const;

export type StaffAssignmentCommand =
  | { role: 'CLINIC_SECRETARY'; userId: string; authorityBundles: string[]; password?: string }
  | { role: 'SUBSTITUTE_SECRETARY'; userId: string; coverageMode: 'ONE_SERVICE_DATE' | 'DATE_RANGE'; fromServiceDate: string; toServiceDate: string }
  | { role: 'INVITE_NEW'; firstName: string; lastName: string; email: string; mobileNumber: string; assignmentType: 'CLINIC_SECRETARY'; authorityBundles: string[]; password?: string }
  | { role: 'INVITE_NEW'; firstName: string; lastName: string; email: string; mobileNumber: string; assignmentType: 'SUBSTITUTE_SECRETARY'; coverageMode: 'ONE_SERVICE_DATE' | 'DATE_RANGE'; fromServiceDate: string; toServiceDate: string };

export function StaffAssignmentDrawer({ data, pending, message, onClose, onSubmit }: { data: AuthoritativeClinicStaff; pending: boolean; message: string; onClose: () => void; onSubmit: (command: StaffAssignmentCommand) => void | Promise<void> }) {
  const current = data.staffAssignments.find((staff) => staff.isClinicSecretary && staff.assignmentActive);
  const candidates = useMemo(() => data.candidates.filter((candidate) => candidate.userId !== current?.userId), [current?.userId, data.candidates]);
  const [step, setStep] = useState(1);
  const [mode, setMode] = useState<'EXISTING' | 'INVITE'>('EXISTING');
  const [userId, setUserId] = useState(candidates[0]?.userId ?? '');
  const [role, setRole] = useState<'CLINIC_SECRETARY' | 'SUBSTITUTE_SECRETARY'>('CLINIC_SECRETARY');
  const [bundles, setBundles] = useState<string[]>([AUTHORITY_BUNDLES[0][0]]);
  const [coverageMode, setCoverageMode] = useState<'ONE_SERVICE_DATE' | 'DATE_RANGE'>('ONE_SERVICE_DATE');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [password, setPassword] = useState('');
  const [invite, setInvite] = useState({ firstName: '', lastName: '', email: '', mobileNumber: '' });
  const selected = candidates.find((candidate) => candidate.userId === userId);
  const inviteName = `${invite.firstName.trim()} ${invite.lastName.trim()}`.trim();
  const selectedName = mode === 'INVITE' ? inviteName : selected?.name;
  const inviteDetailsValid = Boolean(invite.firstName.trim() && invite.lastName.trim() && invite.email.trim() && invite.mobileNumber.trim());
  const configurationValid = role === 'CLINIC_SECRETARY' ? bundles.length > 0 && (!current || password.length > 0) : Boolean(fromDate && toDate && fromDate <= toDate);

  function toggleBundle(bundle: string) {
    setBundles((value) => value.includes(bundle) ? value.filter((item) => item !== bundle) : [...value, bundle]);
  }

  return <aside className="staff-assignment-drawer" aria-label="Assign Secretary drawer">
    <button type="button" className="staff-drawer-close" aria-label="Close Assign Secretary drawer" onClick={onClose}>×</button>
    <span className="staff-drawer-step">{step}</span>
    {step === 1 ? <><h2>Assign Secretary</h2><p>Choose how you want to add or assign a Secretary to {data.clinic.name}.</p><button type="button" className="staff-choice-card is-selected" onClick={() => { setMode('EXISTING'); setStep(2); }}><b>Assign Existing Secretary</b><span>Assign a Secretary who already has an account in the system.</span></button><button type="button" className="staff-choice-card" onClick={() => { setMode('INVITE'); setStep(2); }}><b>Invite New Secretary</b><span>Send an invitation to onboard a new Secretary.</span></button></> : null}
    {step === 2 && mode === 'EXISTING' ? <><h2>Assign Existing Secretary</h2><p>Select a Secretary to assign to {data.clinic.name}.</p><div className="staff-candidate-list">{candidates.length ? candidates.map((candidate) => <button type="button" key={candidate.userId} className={userId === candidate.userId ? 'is-selected' : ''} onClick={() => setUserId(candidate.userId)}><i aria-hidden="true" /><span><strong>{candidate.name}</strong><small>{candidate.email}</small><small>{candidate.mobileNumber}</small></span></button>) : <p>No eligible existing Secretaries are available.</p>}</div></> : null}
    {step === 2 && mode === 'INVITE' ? <><h2>Invitation Details</h2><p>Enter the details of the new Secretary. They will create their own password after opening the invitation.</p><div className="staff-invite-fields"><label>First Name<input value={invite.firstName} onChange={(event) => setInvite({ ...invite, firstName: event.target.value })} /></label><label>Last Name<input value={invite.lastName} onChange={(event) => setInvite({ ...invite, lastName: event.target.value })} /></label><label>Email Address<input type="email" value={invite.email} onChange={(event) => setInvite({ ...invite, email: event.target.value })} /></label><label>Mobile Number<input value={invite.mobileNumber} onChange={(event) => setInvite({ ...invite, mobileNumber: event.target.value })} /></label></div></> : null}
    {step === 3 ? <><h2>Set Assignment Type</h2><p>Choose the type of assignment for {selectedName}.</p><button type="button" className={`staff-choice-card ${role === 'CLINIC_SECRETARY' ? 'is-selected' : ''}`} onClick={() => setRole('CLINIC_SECRETARY')}><b>Clinic Secretary</b><span>Assign as the Clinic Secretary for {data.clinic.name}.</span></button><button type="button" className={`staff-choice-card ${role === 'SUBSTITUTE_SECRETARY' ? 'is-selected' : ''}`} onClick={() => setRole('SUBSTITUTE_SECRETARY')}><b>Substitute Secretary</b><span>Temporary coverage with live clinic and queue authority only during covered dates.</span></button></> : null}
    {step === 4 && role === 'CLINIC_SECRETARY' ? <><h2>Set Authority Bundles</h2><p>Select one or more authority bundles.</p><div className="staff-bundle-list">{AUTHORITY_BUNDLES.map(([value, label]) => <label key={value}><input type="checkbox" checked={bundles.includes(value)} onChange={() => toggleBundle(value)} /> <span><strong>{label}</strong></span></label>)}</div>{current ? <div className="staff-replacement-warning"><strong>Replace current Clinic Secretary?</strong><p>Assigning {selectedName} will replace {current.name} as Clinic Secretary for {data.clinic.name}. {current.name} will be disabled at this clinic. Their account and other clinic assignments remain unaffected.</p><label>Enter your password to confirm<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} /></label></div> : null}</> : null}
    {step === 4 && role === 'SUBSTITUTE_SECRETARY' ? <><h2>Substitute Secretary Coverage</h2><p>Select the inclusive coverage period for {selectedName}.</p><label className="staff-radio"><input type="radio" checked={coverageMode === 'ONE_SERVICE_DATE'} onChange={() => setCoverageMode('ONE_SERVICE_DATE')} /> One Clinic Day</label><label className="staff-radio"><input type="radio" checked={coverageMode === 'DATE_RANGE'} onChange={() => setCoverageMode('DATE_RANGE')} /> Date Range</label><div className="staff-date-fields"><label>From<input type="date" value={fromDate} onChange={(event) => { setFromDate(event.target.value); if (coverageMode === 'ONE_SERVICE_DATE') setToDate(event.target.value); }} /></label><label>To<input type="date" disabled={coverageMode === 'ONE_SERVICE_DATE'} value={toDate} onChange={(event) => setToDate(event.target.value)} /></label></div><div className="staff-neutral-note">Authority is limited to live clinic and queue operations on covered Clinic Days. The Clinic Secretary remains assigned to the clinic.</div></> : null}
    {step === 5 ? <><h2>{mode === 'INVITE' ? 'Review Invitation' : 'Review Assignment'}</h2><p>Please review the {mode === 'INVITE' ? 'invitation and planned assignment' : 'new assignment'} details.</p><dl className="staff-review"><div><dt>Secretary</dt><dd>{selectedName}</dd></div>{mode === 'INVITE' ? <div><dt>Email</dt><dd>{invite.email}</dd></div> : null}<div><dt>Clinic</dt><dd>{data.clinic.name}</dd></div><div><dt>Assignment Type</dt><dd>{role === 'CLINIC_SECRETARY' ? 'Clinic Secretary' : 'Substitute Secretary'}</dd></div>{role === 'CLINIC_SECRETARY' ? <div><dt>Authority Bundles</dt><dd>{bundles.map((bundle) => AUTHORITY_BUNDLES.find(([value]) => value === bundle)?.[1]).join(', ')}</dd></div> : <div><dt>Coverage Period</dt><dd>{fromDate} – {toDate}</dd></div>}</dl>{mode === 'INVITE' ? <div className="staff-neutral-note">This invitation remains pending until accepted. The Secretary is not operationally ready while the invitation is pending.</div> : null}</> : null}
    {message ? <div className="staff-drawer-message" role="status">{message}</div> : null}
    <footer><button type="button" onClick={step === 1 ? onClose : () => setStep((value) => value - 1)}>{step === 1 ? 'Cancel' : 'Back'}</button>{step < 5 ? <button type="button" className="is-primary" disabled={(step === 2 && (mode === 'EXISTING' ? !userId : !inviteDetailsValid)) || (step === 4 && !configurationValid)} onClick={() => setStep((value) => value + 1)}>Next</button> : <button type="button" className="is-primary" disabled={pending} onClick={() => {
      if (mode === 'INVITE') {
        void onSubmit(role === 'CLINIC_SECRETARY' ? { role: 'INVITE_NEW', ...invite, assignmentType: role, authorityBundles: bundles, password: current ? password : undefined } : { role: 'INVITE_NEW', ...invite, assignmentType: role, coverageMode, fromServiceDate: fromDate, toServiceDate: toDate });
      } else if (selected) {
        void onSubmit(role === 'CLINIC_SECRETARY' ? { role, userId: selected.userId, authorityBundles: bundles, password: current ? password : undefined } : { role, userId: selected.userId, coverageMode, fromServiceDate: fromDate, toServiceDate: toDate });
      }
    }}>{pending ? (mode === 'INVITE' ? 'Sending…' : 'Assigning…') : (mode === 'INVITE' ? 'Send Invitation' : 'Confirm Assignment')}</button>}</footer>
  </aside>;
}
