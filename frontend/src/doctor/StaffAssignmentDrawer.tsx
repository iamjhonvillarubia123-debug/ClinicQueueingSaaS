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
  | { role: 'SUBSTITUTE_SECRETARY'; userId: string; coverageMode: 'ONE_SERVICE_DATE' | 'DATE_RANGE'; fromServiceDate: string; toServiceDate: string };

export function StaffAssignmentDrawer({ data, pending, message, onClose, onSubmit }: { data: AuthoritativeClinicStaff; pending: boolean; message: string; onClose: () => void; onSubmit: (command: StaffAssignmentCommand) => void | Promise<void> }) {
  const current = data.staffAssignments.find((staff) => staff.isClinicSecretary && staff.assignmentActive);
  const candidates = useMemo(() => data.candidates.filter((candidate) => candidate.userId !== current?.userId), [current?.userId, data.candidates]);
  const [step, setStep] = useState(1);
  const [userId, setUserId] = useState(candidates[0]?.userId ?? '');
  const [role, setRole] = useState<'CLINIC_SECRETARY' | 'SUBSTITUTE_SECRETARY'>('CLINIC_SECRETARY');
  const [bundles, setBundles] = useState<string[]>([AUTHORITY_BUNDLES[0][0]]);
  const [coverageMode, setCoverageMode] = useState<'ONE_SERVICE_DATE' | 'DATE_RANGE'>('ONE_SERVICE_DATE');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [password, setPassword] = useState('');
  const selected = candidates.find((candidate) => candidate.userId === userId);
  const configurationValid = role === 'CLINIC_SECRETARY' ? bundles.length > 0 && (!current || password.length > 0) : Boolean(fromDate && toDate && fromDate <= toDate);

  function toggleBundle(bundle: string) {
    setBundles((value) => value.includes(bundle) ? value.filter((item) => item !== bundle) : [...value, bundle]);
  }

  return <aside className="staff-assignment-drawer" aria-label="Assign Secretary drawer">
    <button type="button" className="staff-drawer-close" aria-label="Close Assign Secretary drawer" onClick={onClose}>×</button>
    <span className="staff-drawer-step">{step}</span>
    {step === 1 ? <><h2>Assign Secretary</h2><p>Choose how you want to add or assign a Secretary to {data.clinic.name}.</p><button type="button" className="staff-choice-card is-selected" onClick={() => setStep(2)}><b>Assign Existing Secretary</b><span>Assign a Secretary who already has an account in the system.</span></button><button type="button" className="staff-choice-card" disabled><b>Invite New Secretary</b><span>Invitation onboarding will be enabled in its backend slice.</span></button></> : null}
    {step === 2 ? <><h2>Assign Existing Secretary</h2><p>Select a Secretary to assign to {data.clinic.name}.</p><div className="staff-candidate-list">{candidates.length ? candidates.map((candidate) => <button type="button" key={candidate.userId} className={userId === candidate.userId ? 'is-selected' : ''} onClick={() => setUserId(candidate.userId)}><i aria-hidden="true" /><span><strong>{candidate.name}</strong><small>{candidate.email}</small><small>{candidate.mobileNumber}</small></span></button>) : <p>No eligible existing Secretaries are available.</p>}</div></> : null}
    {step === 3 ? <><h2>Set Assignment Type</h2><p>Choose the type of assignment for {selected?.name}.</p><button type="button" className={`staff-choice-card ${role === 'CLINIC_SECRETARY' ? 'is-selected' : ''}`} onClick={() => setRole('CLINIC_SECRETARY')}><b>Clinic Secretary</b><span>Assign as the Clinic Secretary for {data.clinic.name}.</span></button><button type="button" className={`staff-choice-card ${role === 'SUBSTITUTE_SECRETARY' ? 'is-selected' : ''}`} onClick={() => setRole('SUBSTITUTE_SECRETARY')}><b>Substitute Secretary</b><span>Temporary coverage with live clinic and queue authority only during covered dates.</span></button></> : null}
    {step === 4 && role === 'CLINIC_SECRETARY' ? <><h2>Set Authority Bundles</h2><p>Select one or more authority bundles.</p><div className="staff-bundle-list">{AUTHORITY_BUNDLES.map(([value, label]) => <label key={value}><input type="checkbox" checked={bundles.includes(value)} onChange={() => toggleBundle(value)} /> <span><strong>{label}</strong></span></label>)}</div>{current ? <div className="staff-replacement-warning"><strong>Replace current Clinic Secretary?</strong><p>{current.name} will be disabled at this clinic. Their account and other clinic assignments remain unaffected.</p><label>Enter your password to confirm<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} /></label></div> : null}</> : null}
    {step === 4 && role === 'SUBSTITUTE_SECRETARY' ? <><h2>Substitute Secretary Coverage</h2><p>Select the inclusive coverage period for {selected?.name}.</p><label className="staff-radio"><input type="radio" checked={coverageMode === 'ONE_SERVICE_DATE'} onChange={() => setCoverageMode('ONE_SERVICE_DATE')} /> One Clinic Day</label><label className="staff-radio"><input type="radio" checked={coverageMode === 'DATE_RANGE'} onChange={() => setCoverageMode('DATE_RANGE')} /> Date Range</label><div className="staff-date-fields"><label>From<input type="date" value={fromDate} onChange={(event) => { setFromDate(event.target.value); if (coverageMode === 'ONE_SERVICE_DATE') setToDate(event.target.value); }} /></label><label>To<input type="date" disabled={coverageMode === 'ONE_SERVICE_DATE'} value={toDate} onChange={(event) => setToDate(event.target.value)} /></label></div><div className="staff-neutral-note">Authority is limited to live clinic and queue operations on covered Clinic Days. The Clinic Secretary remains assigned to the clinic.</div></> : null}
    {step === 5 ? <><h2>Review Assignment</h2><p>Please review the new assignment details.</p><dl className="staff-review"><div><dt>Secretary</dt><dd>{selected?.name}</dd></div><div><dt>Clinic</dt><dd>{data.clinic.name}</dd></div><div><dt>Assignment Type</dt><dd>{role === 'CLINIC_SECRETARY' ? 'Clinic Secretary' : 'Substitute Secretary'}</dd></div>{role === 'CLINIC_SECRETARY' ? <div><dt>Authority Bundles</dt><dd>{bundles.map((bundle) => AUTHORITY_BUNDLES.find(([value]) => value === bundle)?.[1]).join(', ')}</dd></div> : <div><dt>Coverage Period</dt><dd>{fromDate} – {toDate}</dd></div>}</dl></> : null}
    {message ? <div className="staff-drawer-message" role="status">{message}</div> : null}
    <footer><button type="button" onClick={step === 1 ? onClose : () => setStep((value) => value - 1)}>{step === 1 ? 'Cancel' : 'Back'}</button>{step < 5 ? <button type="button" className="is-primary" disabled={(step === 2 && !userId) || (step === 4 && !configurationValid)} onClick={() => setStep((value) => value + 1)}>Next</button> : <button type="button" className="is-primary" disabled={pending} onClick={() => selected && void onSubmit(role === 'CLINIC_SECRETARY' ? { role, userId: selected.userId, authorityBundles: bundles, password: current ? password : undefined } : { role, userId: selected.userId, coverageMode, fromServiceDate: fromDate, toServiceDate: toDate })}>{pending ? 'Assigning…' : 'Confirm Assignment'}</button>}</footer>
  </aside>;
}
