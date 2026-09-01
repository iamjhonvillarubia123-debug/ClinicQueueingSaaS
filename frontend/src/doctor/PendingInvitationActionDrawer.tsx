import { useState } from 'react';
import type { PendingStaffInvitation } from './AuthoritativeClinicStaffTab';
import { AUTHORITY_BUNDLES } from './StaffAssignmentDrawer';

export type PendingInvitationActionCommand =
  | {
      type: 'UPDATE';
      assignmentType: 'CLINIC_SECRETARY';
      authorityBundles: string[];
      requestedCancelClinicDay: boolean;
    }
  | {
      type: 'UPDATE';
      assignmentType: 'SUBSTITUTE_SECRETARY';
      coverageMode: 'ONE_SERVICE_DATE' | 'DATE_RANGE';
      fromServiceDate: string;
      toServiceDate: string;
    }
  | { type: 'REMOVE' };

export function PendingInvitationActionDrawer({
  invitation,
  mode,
  clinicName,
  pending,
  message,
  onClose,
  onSubmit,
}: {
  invitation: PendingStaffInvitation;
  mode: 'VIEW' | 'EDIT' | 'REMOVE';
  clinicName: string;
  pending: boolean;
  message: string;
  onClose: () => void;
  onSubmit: (command: PendingInvitationActionCommand) => void | Promise<void>;
}) {
  const [bundles, setBundles] = useState<string[]>(invitation.authorityBundles);
  const [cancelClinicDay, setCancelClinicDay] = useState(
    invitation.requestedCancelClinicDay === true,
  );
  const [coverageMode, setCoverageMode] = useState<
    'ONE_SERVICE_DATE' | 'DATE_RANGE'
  >(invitation.coverageMode ?? 'ONE_SERVICE_DATE');
  const [fromDate, setFromDate] = useState(
    invitation.fromServiceDate?.slice(0, 10) ?? '',
  );
  const [toDate, setToDate] = useState(
    invitation.toServiceDate?.slice(0, 10) ?? '',
  );
  const isClinic = invitation.assignmentType === 'CLINIC_SECRETARY';
  const valid = isClinic
    ? bundles.length > 0
    : Boolean(fromDate && toDate && fromDate <= toDate);

  function toggleBundle(value: string) {
    setBundles((current) =>
      current.includes(value)
        ? current.filter((item) => item !== value)
        : [...current, value],
    );
  }

  function submitEdit() {
    if (isClinic) {
      void onSubmit({
        type: 'UPDATE',
        assignmentType: 'CLINIC_SECRETARY',
        authorityBundles: bundles,
        requestedCancelClinicDay: cancelClinicDay,
      });
      return;
    }
    void onSubmit({
      type: 'UPDATE',
      assignmentType: 'SUBSTITUTE_SECRETARY',
      coverageMode,
      fromServiceDate: fromDate,
      toServiceDate: coverageMode === 'ONE_SERVICE_DATE' ? fromDate : toDate,
    });
  }

  return (
    <aside className="staff-assignment-drawer" aria-label={`${mode} pending invitation drawer`}>
      <button type="button" className="staff-drawer-close" aria-label="Close invitation drawer" onClick={onClose}>×</button>
      <span className="staff-drawer-step">{mode === 'VIEW' ? '◉' : mode === 'EDIT' ? '✎' : '⌫'}</span>
      <h2>{mode === 'VIEW' ? 'Invitation Details' : mode === 'EDIT' ? 'Edit Planned Authority' : 'Remove Pending Invitation'}</h2>
      <p>{invitation.name} · {clinicName}</p>

      <dl className="staff-review">
        <div><dt>Email</dt><dd>{invitation.email}</dd></div>
        <div><dt>Mobile</dt><dd>{invitation.mobileNumber}</dd></div>
        <div><dt>Status</dt><dd>Pending Invitation</dd></div>
        <div><dt>Role</dt><dd>{isClinic ? 'Clinic Secretary' : 'Substitute Secretary'}</dd></div>
      </dl>

      {mode === 'VIEW' ? (
        <dl className="staff-review">
          <div>
            <dt>Planned Authority</dt>
            <dd>{isClinic ? invitation.authorityBundles.map((value) => AUTHORITY_BUNDLES.find(([id]) => id === value)?.[1] ?? value).join(', ') : `${fromDate} to ${toDate}`}</dd>
          </div>
          <div><dt>Expires</dt><dd>{new Date(invitation.expiresAt).toLocaleString()}</dd></div>
        </dl>
      ) : mode === 'EDIT' && isClinic ? (
        <>
          <p className="staff-action-copy">Edit the authority that will be granted only after this invitation is accepted.</p>
          <div className="staff-bundle-list">
            {AUTHORITY_BUNDLES.map(([value, label]) => (
              <label key={value}>
                <input type="checkbox" checked={bundles.includes(value)} onChange={() => toggleBundle(value)} />
                <span><strong>{label}</strong></span>
              </label>
            ))}
            <label>
              <input type="checkbox" checked={cancelClinicDay} onChange={(event) => setCancelClinicDay(event.target.checked)} />
              <span><strong>Allow Cancel Clinic Day</strong></span>
            </label>
          </div>
        </>
      ) : mode === 'EDIT' ? (
        <>
          <p className="staff-action-copy">Edit the planned substitute coverage. It remains pending until accepted.</p>
          <label className="staff-radio"><input type="radio" checked={coverageMode === 'ONE_SERVICE_DATE'} onChange={() => { setCoverageMode('ONE_SERVICE_DATE'); setToDate(fromDate); }} /> One Clinic Day</label>
          <label className="staff-radio"><input type="radio" checked={coverageMode === 'DATE_RANGE'} onChange={() => setCoverageMode('DATE_RANGE')} /> Date Range</label>
          <div className="staff-date-fields">
            <label>From<input type="date" value={fromDate} onChange={(event) => { setFromDate(event.target.value); if (coverageMode === 'ONE_SERVICE_DATE') setToDate(event.target.value); }} /></label>
            <label>To<input type="date" disabled={coverageMode === 'ONE_SERVICE_DATE'} value={toDate} onChange={(event) => setToDate(event.target.value)} /></label>
          </div>
        </>
      ) : (
        <div className="staff-replacement-warning">
          <strong>Permanently remove this clinic connection?</strong>
          <p>The invitation will stop working and disappear from the clinic staff list. Its audit record is preserved for traceability.</p>
        </div>
      )}

      {message ? <div className="staff-drawer-message" role="status">{message}</div> : null}
      <footer>
        <button type="button" onClick={onClose}>{mode === 'VIEW' ? 'Close' : 'Cancel'}</button>
        {mode !== 'VIEW' ? (
          <button type="button" className="is-primary" disabled={pending || (mode === 'EDIT' && !valid)} onClick={mode === 'EDIT' ? submitEdit : () => void onSubmit({ type: 'REMOVE' })}>
            {pending ? 'Updating…' : mode === 'EDIT' ? 'Save Changes' : 'Remove Connection'}
          </button>
        ) : null}
      </footer>
    </aside>
  );
}
