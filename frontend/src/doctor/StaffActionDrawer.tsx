import { useState } from 'react';
import type { ClinicStaffAssignment } from './AuthoritativeClinicStaffTab';
import { AUTHORITY_BUNDLES } from './StaffAssignmentDrawer';

export type StaffActionCommand =
  | { type: 'DISABLE' }
  | { type: 'REMOVE'; password: string }
  | { type: 'ACTIVATE_CLINIC'; authorityBundles: string[]; password?: string }
  | { type: 'CANCEL_COVERAGE'; coverageId: string }
  | {
      type: 'ACTIVATE_SUBSTITUTE';
      coverageMode: 'ONE_SERVICE_DATE' | 'DATE_RANGE';
      fromServiceDate: string;
      toServiceDate: string;
    };

export type StaffRemovalImpact = {
  practiceStaffId: string;
  clinicName: string | null;
  assignmentActive: boolean;
  isCurrentClinicSecretary: boolean;
  clinicWillHaveNoCurrentSecretary: boolean;
  operatingClinicDays: Array<{
    serviceDate: string;
    status: 'NOT_STARTED' | 'DELAYED' | 'STARTED';
  }>;
  activeSubstituteCoverages: Array<{
    coverageMode: 'ONE_SERVICE_DATE' | 'DATE_RANGE';
    fromServiceDate: string;
    toServiceDate: string;
  }>;
  pendingConfigurationDraftCount: number;
  bookedAppointmentCount: number;
  bookingsRemainScheduled: true;
  auditHistoryPreserved: true;
};

export function StaffActionDrawer({
  staff,
  mode,
  replacementRequired,
  pending,
  message,
  removalImpact,
  impactLoading = false,
  impactError = '',
  clinicName,
  onClose,
  onSubmit,
}: {
  staff: ClinicStaffAssignment;
  mode: 'VIEW' | 'EDIT' | 'REMOVE';
  replacementRequired: boolean;
  pending: boolean;
  message: string;
  removalImpact?: StaffRemovalImpact | null;
  impactLoading?: boolean;
  impactError?: string;
  clinicName: string;
  onClose: () => void;
  onSubmit: (command: StaffActionCommand) => void | Promise<void>;
}) {
  const [password, setPassword] = useState('');
  const [removalConfirmed, setRemovalConfirmed] = useState(false);
  const [bundles, setBundles] = useState<string[]>(
    staff.previousAuthorityBundles.length
      ? staff.previousAuthorityBundles
      : [AUTHORITY_BUNDLES[0][0]],
  );
  const [coverageMode, setCoverageMode] = useState<
    'ONE_SERVICE_DATE' | 'DATE_RANGE'
  >('ONE_SERVICE_DATE');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const isClinic = staff.assignmentType === 'CLINIC_SECRETARY';
  const activeCoverage = staff.substituteCoverages.find(
    (coverage) => coverage.status === 'ACTIVE',
  );
  const needsPassword = isClinic && replacementRequired;
  const toggle = (value: string) =>
    setBundles((current) =>
      current.includes(value)
        ? current.filter((item) => item !== value)
        : [...current, value],
    );

  if (mode === 'VIEW') {
    return (
      <aside
        className="staff-assignment-drawer"
        aria-label="View Secretary profile drawer"
      >
        <button
          type="button"
          className="staff-drawer-close"
          aria-label="Close Secretary profile"
          onClick={onClose}
        >
          ×
        </button>
        <span className="staff-drawer-step" aria-hidden="true">
          ◉
        </span>
        <h2>Secretary Profile</h2>
        <p>Read-only account and clinic relationship details.</p>
        <div className="staff-profile-identity">
          <strong>{staff.name}</strong>
          <span>{staff.email}</span>
          <span>{staff.mobileNumber}</span>
        </div>
        <dl className="staff-review">
          <div>
            <dt>Clinic</dt>
            <dd>{clinicName}</dd>
          </div>
          <div>
            <dt>Role</dt>
            <dd>{isClinic ? 'Clinic Secretary' : 'Substitute Secretary'}</dd>
          </div>
          <div>
            <dt>Status</dt>
            <dd>
              {staff.operationallyReady
                ? 'Active'
                : 'Disabled (at this clinic)'}
            </dd>
          </div>
          <div>
            <dt>Assigned Since</dt>
            <dd>{new Date(staff.assignedAt).toLocaleString()}</dd>
          </div>
          {isClinic ? (
            <div>
              <dt>Authority Bundles</dt>
              <dd>
                {staff.authorityBundles.length
                  ? staff.authorityBundles
                      .map(
                        (bundle) =>
                          AUTHORITY_BUNDLES.find(
                            ([value]) => value === bundle,
                          )?.[1] ?? bundle,
                      )
                      .join(', ')
                  : 'None active'}
              </dd>
            </div>
          ) : (
            <div>
              <dt>Coverage</dt>
              <dd>
                {staff.substituteCoverages.length
                  ? staff.substituteCoverages
                      .map(
                        (coverage) =>
                          `${coverage.fromServiceDate.slice(0, 10)} – ${coverage.toServiceDate.slice(0, 10)} (${coverage.status})`,
                      )
                      .join(', ')
                  : 'No coverage recorded'}
              </dd>
            </div>
          )}
        </dl>
        <footer>
          <button type="button" className="is-primary" onClick={onClose}>
            Close
          </button>
        </footer>
      </aside>
    );
  }

  function submitEdit() {
    if (staff.assignmentActive) {
      if (isClinic) void onSubmit({ type: 'DISABLE' });
      else if (activeCoverage)
        void onSubmit({
          type: 'CANCEL_COVERAGE',
          coverageId: activeCoverage.id,
        });
    } else if (isClinic)
      void onSubmit({
        type: 'ACTIVATE_CLINIC',
        authorityBundles: bundles,
        ...(replacementRequired ? { password } : {}),
      });
    else
      void onSubmit({
        type: 'ACTIVATE_SUBSTITUTE',
        coverageMode,
        fromServiceDate: fromDate,
        toServiceDate: toDate,
      });
  }

  return (
    <aside
      className="staff-assignment-drawer"
      aria-label={`${mode === 'EDIT' ? 'Edit' : 'Remove'} Secretary drawer`}
    >
      <button
        type="button"
        className="staff-drawer-close"
        aria-label="Close Secretary action drawer"
        onClick={onClose}
      >
        ×
      </button>
      <span className="staff-drawer-step">{mode === 'EDIT' ? '✎' : '⌫'}</span>
      <h2>
        {mode === 'EDIT' ? 'Edit Secretary Assignment' : 'Remove Secretary'}
      </h2>
      <p>
        {staff.name} · {clinicName}
      </p>

      {mode === 'EDIT' ? (
        <>
          <dl className="staff-review">
            <div>
              <dt>Role</dt>
              <dd>{isClinic ? 'Clinic Secretary' : 'Substitute Secretary'}</dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>
                {staff.assignmentActive
                  ? 'Active'
                  : 'Disabled (at this clinic)'}
              </dd>
            </div>
          </dl>
          {staff.assignmentActive ? (
            <div className="staff-replacement-warning">
              <strong>Disable at this clinic?</strong>
              <p>
                {isClinic
                  ? 'This ends the Clinic Secretary assignment and revokes clinic authority. Their account and assignments at other clinics remain unaffected.'
                  : 'This cancels the active substitute coverage. Their account and other clinic assignments remain unaffected.'}
              </p>
            </div>
          ) : isClinic ? (
            <>
              <p className="staff-action-copy">
                Choose at least one authority bundle before reactivating this
                Clinic Secretary.
              </p>
              <div className="staff-bundle-list">
                {AUTHORITY_BUNDLES.map(([value, label]) => (
                  <label key={value}>
                    <input
                      type="checkbox"
                      checked={bundles.includes(value)}
                      onChange={() => toggle(value)}
                    />{' '}
                    <span>
                      <strong>{label}</strong>
                    </span>
                  </label>
                ))}
              </div>
              {replacementRequired ? (
                <div className="staff-replacement-warning">
                  <strong>
                    This will replace the current Clinic Secretary.
                  </strong>
                  <p>
                    The current assignment will be disabled at this clinic only.
                  </p>
                </div>
              ) : null}
            </>
          ) : (
            <>
              <p className="staff-action-copy">
                Set new substitute coverage dates.
              </p>
              <label className="staff-radio">
                <input
                  type="radio"
                  checked={coverageMode === 'ONE_SERVICE_DATE'}
                  onChange={() => setCoverageMode('ONE_SERVICE_DATE')}
                />{' '}
                One Clinic Day
              </label>
              <label className="staff-radio">
                <input
                  type="radio"
                  checked={coverageMode === 'DATE_RANGE'}
                  onChange={() => setCoverageMode('DATE_RANGE')}
                />{' '}
                Date Range
              </label>
              <div className="staff-date-fields">
                <label>
                  From
                  <input
                    type="date"
                    value={fromDate}
                    onChange={(event) => {
                      setFromDate(event.target.value);
                      if (coverageMode === 'ONE_SERVICE_DATE')
                        setToDate(event.target.value);
                    }}
                  />
                </label>
                <label>
                  To
                  <input
                    type="date"
                    disabled={coverageMode === 'ONE_SERVICE_DATE'}
                    value={toDate}
                    onChange={(event) => setToDate(event.target.value)}
                  />
                </label>
              </div>
            </>
          )}
        </>
      ) : (
        <div className="staff-removal-impact">
          <div className="staff-replacement-warning">
            <strong>Permanently remove this clinic connection?</strong>
            <p>
              This Secretary will disappear from this clinic’s staff list and
              lose all authority at this clinic. Their account and other clinic
              relationships remain unaffected.
            </p>
            <p>
              No changes are made unless removal succeeds. If you cancel or the
              removal fails, the Secretary remains connected with their current
              status and authority unchanged.
            </p>
          </div>
          {impactLoading ? (
            <div className="staff-drawer-message" role="status">
              Checking clinic consequences…
            </div>
          ) : impactError ? (
            <div className="staff-drawer-message is-error" role="alert">
              {impactError}
            </div>
          ) : removalImpact ? (
            <>
              <h3>If you proceed successfully</h3>
              <ul>
                <li>All active authority for this clinic will be revoked.</li>
                {removalImpact.clinicWillHaveNoCurrentSecretary ? (
                  <li className="is-critical">
                    This clinic will have no active Clinic Secretary.
                  </li>
                ) : null}
                {removalImpact.operatingClinicDays.length ? (
                  <li className="is-critical">
                    Operating responsibility will be cleared from{' '}
                    {removalImpact.operatingClinicDays.length} clinic day
                    {removalImpact.operatingClinicDays.length === 1
                      ? ''
                      : 's'}:{' '}
                    {removalImpact.operatingClinicDays
                      .map(
                        (day) =>
                          `${new Date(`${day.serviceDate}T00:00:00`).toLocaleDateString()} (${day.status.replaceAll('_', ' ').toLowerCase()})`,
                      )
                      .join(', ')}
                    .
                  </li>
                ) : null}
                {removalImpact.activeSubstituteCoverages.length ? (
                  <li>
                    {removalImpact.activeSubstituteCoverages.length} active
                    substitute coverage period
                    {removalImpact.activeSubstituteCoverages.length === 1
                      ? ''
                      : 's'}{' '}
                    will be cancelled.
                  </li>
                ) : null}
                {removalImpact.pendingConfigurationDraftCount ? (
                  <li>
                    {removalImpact.pendingConfigurationDraftCount} unfinished
                    clinic configuration draft
                    {removalImpact.pendingConfigurationDraftCount === 1
                      ? ''
                      : 's'}{' '}
                    will remain stored, but this Secretary can no longer edit or
                    submit them.
                  </li>
                ) : null}
                <li>
                  {removalImpact.bookedAppointmentCount} current or upcoming
                  booked appointment
                  {removalImpact.bookedAppointmentCount === 1 ? '' : 's'} will
                  remain scheduled and will not be cancelled.
                </li>
                <li>
                  The relationship and authority history will remain in the
                  audit log.
                </li>
              </ul>
            </>
          ) : null}
        </div>
      )}

      {mode === 'REMOVE' && removalConfirmed ? (
        <label className="staff-password-field">
          Enter your current password to permanently remove this connection
          <input
            type="password"
            autoFocus
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
      ) : null}

      {needsPassword && mode === 'EDIT' ? (
        <label className="staff-password-field">
          Enter your current password to confirm
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
      ) : null}
      {message ? (
        <div className="staff-drawer-message" role="status">
          {message}
        </div>
      ) : null}
      <footer>
        <button type="button" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="is-primary"
          disabled={
            pending ||
            (mode === 'REMOVE' &&
              (impactLoading || Boolean(impactError) || !removalImpact)) ||
            (mode === 'REMOVE' && removalConfirmed && !password) ||
            (mode === 'EDIT' && needsPassword && !password) ||
            (mode === 'EDIT' &&
              !staff.assignmentActive &&
              isClinic &&
              bundles.length === 0) ||
            (mode === 'EDIT' &&
              !staff.assignmentActive &&
              !isClinic &&
              (!fromDate || !toDate || fromDate > toDate))
          }
          onClick={
            mode === 'EDIT'
              ? submitEdit
              : removalConfirmed
                ? () => void onSubmit({ type: 'REMOVE', password })
                : () => setRemovalConfirmed(true)
          }
        >
          {pending
            ? 'Updating…'
            : mode === 'EDIT'
              ? staff.assignmentActive
                ? 'Disable at this clinic'
                : 'Activate at this clinic'
              : removalConfirmed
                ? 'Permanently Remove'
                : 'Proceed with Removal'}
        </button>
      </footer>
    </aside>
  );
}
