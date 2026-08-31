import { useState } from 'react';
import type { ClinicStaffAssignment } from './AuthoritativeClinicStaffTab';
import { AUTHORITY_BUNDLES } from './StaffAssignmentDrawer';

export type StaffActionCommand =
  | { type: 'DISABLE' | 'REMOVE'; password: string }
  | { type: 'ACTIVATE_CLINIC'; authorityBundles: string[]; password?: string }
  | { type: 'CANCEL_COVERAGE'; coverageId: string }
  | { type: 'ACTIVATE_SUBSTITUTE'; coverageMode: 'ONE_SERVICE_DATE' | 'DATE_RANGE'; fromServiceDate: string; toServiceDate: string };

export function StaffActionDrawer({ staff, mode, replacementRequired, pending, message, clinicName, onClose, onSubmit }: { staff: ClinicStaffAssignment; mode: 'EDIT' | 'REMOVE'; replacementRequired: boolean; pending: boolean; message: string; clinicName: string; onClose: () => void; onSubmit: (command: StaffActionCommand) => void | Promise<void> }) {
  const [password, setPassword] = useState('');
  const [bundles, setBundles] = useState<string[]>(staff.previousAuthorityBundles.length ? staff.previousAuthorityBundles : [AUTHORITY_BUNDLES[0][0]]);
  const [coverageMode, setCoverageMode] = useState<'ONE_SERVICE_DATE' | 'DATE_RANGE'>('ONE_SERVICE_DATE');
  const [fromDate, setFromDate] = useState(''); const [toDate, setToDate] = useState('');
  const isClinic = staff.assignmentType === 'CLINIC_SECRETARY';
  const activeCoverage = staff.substituteCoverages.find((coverage) => coverage.status === 'ACTIVE');
  const needsPassword = isClinic && (staff.assignmentActive || replacementRequired);
  const toggle = (value: string) => setBundles((current) => current.includes(value) ? current.filter((item) => item !== value) : [...current, value]);

  function submitEdit() {
    if (staff.assignmentActive) {
      if (isClinic) void onSubmit({ type: 'DISABLE', password });
      else if (activeCoverage) void onSubmit({ type: 'CANCEL_COVERAGE', coverageId: activeCoverage.id });
    } else if (isClinic) void onSubmit({ type: 'ACTIVATE_CLINIC', authorityBundles: bundles, ...(replacementRequired ? { password } : {}) });
    else void onSubmit({ type: 'ACTIVATE_SUBSTITUTE', coverageMode, fromServiceDate: fromDate, toServiceDate: toDate });
  }

  return <aside className="staff-assignment-drawer" aria-label={`${mode === 'EDIT' ? 'Edit' : 'Remove'} Secretary drawer`}>
    <button type="button" className="staff-drawer-close" aria-label="Close Secretary action drawer" onClick={onClose}>×</button>
    <span className="staff-drawer-step">{mode === 'EDIT' ? '✎' : '⌫'}</span>
    <h2>{mode === 'EDIT' ? 'Edit Secretary Assignment' : 'Remove Secretary'}</h2>
    <p>{staff.name} · {clinicName}</p>

    {mode === 'EDIT' ? <>
      <dl className="staff-review"><div><dt>Role</dt><dd>{isClinic ? 'Clinic Secretary' : 'Substitute Secretary'}</dd></div><div><dt>Status</dt><dd>{staff.assignmentActive ? 'Active' : 'Disabled (at this clinic)'}</dd></div></dl>
      {staff.assignmentActive ? <div className="staff-replacement-warning"><strong>Disable at this clinic?</strong><p>{isClinic ? 'This ends the Clinic Secretary assignment and revokes clinic authority. Their account and assignments at other clinics remain unaffected.' : 'This cancels the active substitute coverage. Their account and other clinic assignments remain unaffected.'}</p></div> : isClinic ? <><p className="staff-action-copy">Choose at least one authority bundle before reactivating this Clinic Secretary.</p><div className="staff-bundle-list">{AUTHORITY_BUNDLES.map(([value, label]) => <label key={value}><input type="checkbox" checked={bundles.includes(value)} onChange={() => toggle(value)} /> <span><strong>{label}</strong></span></label>)}</div>{replacementRequired ? <div className="staff-replacement-warning"><strong>This will replace the current Clinic Secretary.</strong><p>The current assignment will be disabled at this clinic only.</p></div> : null}</> : <><p className="staff-action-copy">Set new substitute coverage dates.</p><label className="staff-radio"><input type="radio" checked={coverageMode === 'ONE_SERVICE_DATE'} onChange={() => setCoverageMode('ONE_SERVICE_DATE')} /> One Clinic Day</label><label className="staff-radio"><input type="radio" checked={coverageMode === 'DATE_RANGE'} onChange={() => setCoverageMode('DATE_RANGE')} /> Date Range</label><div className="staff-date-fields"><label>From<input type="date" value={fromDate} onChange={(event) => { setFromDate(event.target.value); if (coverageMode === 'ONE_SERVICE_DATE') setToDate(event.target.value); }} /></label><label>To<input type="date" disabled={coverageMode === 'ONE_SERVICE_DATE'} value={toDate} onChange={(event) => setToDate(event.target.value)} /></label></div></>}
    </> : <div className="staff-replacement-warning"><strong>Remove this clinic assignment?</strong><p>{staff.assignmentActive ? 'This removes current clinic authority and preserves the assignment in disabled history. The Secretary account and other clinics remain unaffected.' : 'This assignment has already ended and is retained for required clinic history. It cannot be permanently erased from this screen.'}</p></div>}

    {needsPassword && (mode === 'EDIT' || staff.assignmentActive) ? <label className="staff-password-field">Enter your current password to confirm<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} /></label> : null}
    {message ? <div className="staff-drawer-message" role="status">{message}</div> : null}
    <footer><button type="button" onClick={onClose}>Cancel</button>{mode === 'REMOVE' && !staff.assignmentActive ? <button type="button" className="is-primary" onClick={onClose}>Close</button> : <button type="button" className="is-primary" disabled={pending || (needsPassword && !password) || (!staff.assignmentActive && isClinic && bundles.length === 0) || (!staff.assignmentActive && !isClinic && (!fromDate || !toDate || fromDate > toDate))} onClick={mode === 'EDIT' ? submitEdit : () => void onSubmit(isClinic ? { type: 'REMOVE', password } : activeCoverage ? { type: 'CANCEL_COVERAGE', coverageId: activeCoverage.id } : { type: 'ACTIVATE_SUBSTITUTE', coverageMode, fromServiceDate: fromDate, toServiceDate: toDate })}>{pending ? 'Updating…' : mode === 'EDIT' ? (staff.assignmentActive ? 'Disable at this clinic' : 'Activate at this clinic') : 'Remove Assignment'}</button>}</footer>
  </aside>;
}
