import { CoverageScheduleEditor } from './CoverageScheduleEditor';
import type { CoverageRange } from './coverage-ranges';
import { invitationRanges, formatCoverage } from './coverage-ranges';
import { useState } from 'react';
import type { PendingStaffInvitation } from './AuthoritativeClinicStaffTab';
import { AUTHORITY_BUNDLES } from './StaffAssignmentDrawer';

export type PendingInvitationActionCommand =
  | {
      type: 'UPDATE';
      identifier: string;
      assignmentType: 'CLINIC_SECRETARY';
      authorityBundles: string[];
      requestedCancelClinicDay: boolean;
      password?: string;
    }
  | {
      type: 'UPDATE';
      identifier: string;
      assignmentType: 'SUBSTITUTE_SECRETARY';
      coverageRanges?: CoverageRange[];
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
  const [identifier, setIdentifier] = useState(
    (invitation.email ?? invitation.mobileNumber ?? '').trim().toLowerCase(),
  );
  const [bundles, setBundles] = useState<string[]>(invitation.authorityBundles);
  const [cancelClinicDay, setCancelClinicDay] = useState(
    invitation.requestedCancelClinicDay === true,
  );
  const [password, setPassword] = useState('');
  const [coverageRanges, setCoverageRanges] = useState(() => invitationRanges(invitation));
  const fromDate = coverageRanges[0]?.fromServiceDate ?? '';
  const toDate = coverageRanges.at(-1)?.toServiceDate ?? '';
  const coverageMode = fromDate === toDate ? 'ONE_SERVICE_DATE' : 'DATE_RANGE';
  const isClinic = invitation.assignmentType === 'CLINIC_SECRETARY';
  const isGrantingCancelClinicDay =
    isClinic &&
    cancelClinicDay &&
    invitation.requestedCancelClinicDay !== true;
  const valid =
    Boolean(identifier.trim()) &&
    (isClinic
      ? bundles.length > 0 &&
        (!isGrantingCancelClinicDay || Boolean(password.trim()))
      : Boolean(fromDate && toDate && fromDate <= toDate));
  const messageIsError = Boolean(
    message && !message.toLowerCase().includes('success'),
  );

  function toggleBundle(value: string) {
    setBundles((current) =>
      current.includes(value)
        ? current.filter((item) => item !== value)
        : [...current, value],
    );
  }

  function submitEdit() {
    const normalizedIdentifier = identifier.trim().toLowerCase();
    if (isClinic) {
      void onSubmit({
        type: 'UPDATE',
        identifier: normalizedIdentifier,
        assignmentType: 'CLINIC_SECRETARY',
        authorityBundles: bundles,
        requestedCancelClinicDay: cancelClinicDay,
        ...(isGrantingCancelClinicDay ? { password } : {}),
      });
      return;
    }
    void onSubmit({
      type: 'UPDATE',
      identifier: normalizedIdentifier,
      assignmentType: 'SUBSTITUTE_SECRETARY',
      coverageMode,
      coverageRanges,
      fromServiceDate: fromDate,
      toServiceDate: coverageMode === 'ONE_SERVICE_DATE' ? fromDate : toDate,
    });
  }

  return (
    <aside
      className="staff-assignment-drawer"
      aria-label={`${mode} pending invitation drawer`}
    >
      <button
        type="button"
        className="staff-drawer-close"
        aria-label="Close invitation drawer"
        onClick={onClose}
      >
        ×
      </button>
      <span className="staff-drawer-step">
        {mode === 'VIEW' ? '◉' : mode === 'EDIT' ? '✎' : '⌫'}
      </span>
      <h2>
        {mode === 'VIEW'
          ? 'Invitation Details'
          : mode === 'EDIT'
            ? 'Edit Pending Invitation'
            : 'Remove Pending Invitation'}
      </h2>
      <p>
        {invitation.name} · {clinicName}
      </p>

      {mode === 'EDIT' ? (
        <div className="staff-invite-fields">
          <label>
            Secretary Email or Mobile Number
            <input
              type="text"
              autoComplete="username"
              value={identifier}
              onChange={(event) => setIdentifier(event.target.value)}
            />
          </label>
          <small>
            Changing this sign-in identifier makes the system revalidate the target Secretary
            account before the invitation can be updated.
          </small>
        </div>
      ) : (
        <dl className="staff-review">
          <div>
            <dt>Email</dt>
            <dd>{invitation.email}</dd>
          </div>
          <div>
            <dt>Mobile</dt>
            <dd>{invitation.mobileNumber}</dd>
          </div>
          <div>
            <dt>Status</dt>
            <dd>Pending Invitation</dd>
          </div>
          <div>
            <dt>Role</dt>
            <dd>{isClinic ? 'Clinic Secretary' : 'Substitute Secretary'}</dd>
          </div>
        </dl>
      )}

      {mode === 'EDIT' && !isClinic ? <div className="staff-replacement-warning"><p>Remaining coverage: {formatCoverage(invitationRanges(invitation))}. Dates removed by earlier replacements remain excluded.</p>On acceptance, this invitation replaces any Substitute Secretary coverage on the selected dates. Dates outside that period remain assigned.</div> : null}
      {mode === 'VIEW' ? (
        <dl className="staff-review">
          <div>
            <dt>Planned Authority</dt>
            <dd>
              {isClinic
                ? invitation.authorityBundles
                    .map(
                      (value) =>
                        AUTHORITY_BUNDLES.find(([id]) => id === value)?.[1] ??
                        value,
                    )
                    .join(', ')
                : formatCoverage(invitationRanges(invitation))}
            </dd>
          </div>
          <div>
            <dt>Expires</dt>
            <dd>{new Date(invitation.expiresAt).toLocaleString()}</dd>
          </div>
        </dl>
      ) : mode === 'EDIT' && isClinic ? (
        <>
          <p className="staff-action-copy">
            Edit the authority that will be granted only after this invitation is
            accepted.
          </p>
          <div className="staff-bundle-list">
            {AUTHORITY_BUNDLES.map(([value, label]) => (
              <label key={value}>
                <input
                  type="checkbox"
                  checked={bundles.includes(value)}
                  onChange={() => toggleBundle(value)}
                />
                <span>
                  <strong>{label}</strong>
                </span>
              </label>
            ))}
            <label>
              <input
                type="checkbox"
                checked={cancelClinicDay}
                onChange={(event) => setCancelClinicDay(event.target.checked)}
              />
              <span>
                <strong>Allow Cancel Clinic Day</strong>
              </span>
            </label>
          </div>
          {isGrantingCancelClinicDay ? (
            <div className="staff-invite-fields">
              <label>
                Current Doctor Password
                <input
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </label>
              <small>
                Re-authentication is required only when newly granting Cancel
                Clinic Day authority.
              </small>
            </div>
          ) : null}
        </>
      ) : mode === 'EDIT' ? (
        <>
          <p className="staff-action-copy">
            Edit the planned substitute coverage. It remains pending until
            accepted.
          </p>
          <CoverageScheduleEditor initialRanges={coverageRanges} onChange={setCoverageRanges} />
        </>
      ) : mode === 'REMOVE' ? (
        <div className="staff-replacement-warning">
          <strong>Cancel and remove this pending invitation?</strong>
          <p>
            The invitation will disappear from the clinic staff list. Its link
            will show the Secretary that it was cancelled and will no longer
            allow acceptance. The audit record is preserved for traceability.
          </p>
        </div>
      ) : null}

      {message ? (
        <div
          className={`staff-drawer-message${messageIsError ? ' is-error' : ''}`}
          role={messageIsError ? 'alert' : 'status'}
        >
          {message}
        </div>
      ) : null}
      <footer>
        <button type="button" onClick={onClose}>
          {mode === 'VIEW' ? 'Close' : 'Cancel'}
        </button>
        {mode !== 'VIEW' ? (
          <button
            type="button"
            className="is-primary"
            disabled={pending || (mode === 'EDIT' && !valid)}
            onClick={
              mode === 'EDIT'
                ? submitEdit
                : () => void onSubmit({ type: 'REMOVE' })
            }
          >
            {pending
              ? 'Updating…'
              : mode === 'EDIT'
                ? 'Save Changes'
                : 'Cancel Invitation'}
          </button>
        ) : null}
      </footer>
    </aside>
  );
}
