import { useMemo, useState } from 'react';
import type { AuthoritativeClinicStaff } from './AuthoritativeClinicStaffTab';

export const AUTHORITY_BUNDLES = [
  ['QUEUE_AND_CLINIC_DAY_OPERATIONS', 'Queue & Clinic Day Operations'],
  ['APPOINTMENTS_AND_PATIENT_INTAKE', 'Appointments & Patient Intake'],
  ['CLINIC_CONFIGURATION_DRAFTING', 'Clinic Configuration Drafting'],
  ['REPORTS_VIEW_ONLY', 'Reports · View Only'],
] as const;

export type StaffAssignmentCommand =
  | {
      role: 'CLINIC_SECRETARY';
      userId: string;
      firstName: string;
      lastName: string;
      email: string;
      mobileNumber: string;
      authorityBundles: string[];
      requestedCancelClinicDay: boolean;
      password?: string;
    }
  | {
      role: 'SUBSTITUTE_SECRETARY';
      userId: string;
      firstName: string;
      lastName: string;
      email: string;
      mobileNumber: string;
      coverageMode: 'ONE_SERVICE_DATE' | 'DATE_RANGE';
      fromServiceDate: string;
      toServiceDate: string;
    }
  | {
      role: 'INVITE_NEW';
      firstName: string;
      lastName: string;
      email: string;
      mobileNumber: string;
      assignmentType: 'CLINIC_SECRETARY';
      authorityBundles: string[];
      requestedCancelClinicDay: boolean;
      password?: string;
    }
  | {
      role: 'INVITE_NEW';
      firstName: string;
      lastName: string;
      email: string;
      mobileNumber: string;
      assignmentType: 'SUBSTITUTE_SECRETARY';
      coverageMode: 'ONE_SERVICE_DATE' | 'DATE_RANGE';
      fromServiceDate: string;
      toServiceDate: string;
    };

export function StaffAssignmentDrawer({
  data,
  pending,
  message,
  onClose,
  onSubmit,
}: {
  data: AuthoritativeClinicStaff;
  pending: boolean;
  message: string;
  onClose: () => void;
  onSubmit: (command: StaffAssignmentCommand) => void | Promise<void>;
}) {
  const current = data.staffAssignments.find(
    (staff) => staff.isClinicSecretary && staff.assignmentActive,
  );
  const candidates = useMemo(
    () =>
      data.candidates.filter(
        (candidate) => candidate.userId !== current?.userId,
      ),
    [current?.userId, data.candidates],
  );
  const [step, setStep] = useState(1);
  const [mode, setMode] = useState<'EXISTING' | 'INVITE'>('EXISTING');
  const [userId, setUserId] = useState(candidates[0]?.userId ?? '');
  const [candidateSearch, setCandidateSearch] = useState('');
  const [role, setRole] = useState<'CLINIC_SECRETARY' | 'SUBSTITUTE_SECRETARY'>(
    'CLINIC_SECRETARY',
  );
  const [bundles, setBundles] = useState<string[]>([AUTHORITY_BUNDLES[0][0]]);
  const [cancelClinicDay, setCancelClinicDay] = useState(false);
  const [coverageMode, setCoverageMode] = useState<
    'ONE_SERVICE_DATE' | 'DATE_RANGE'
  >('ONE_SERVICE_DATE');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [password, setPassword] = useState('');
  const [invite, setInvite] = useState({
    firstName: '',
    lastName: '',
    email: '',
    mobileNumber: '',
  });
  const selected = candidates.find((candidate) => candidate.userId === userId);
  const visibleCandidates = useMemo(() => {
    const query = candidateSearch.trim().toLowerCase();
    if (!query) return candidates;
    return candidates.filter((candidate) =>
      [candidate.name, candidate.email, candidate.mobileNumber].some((value) =>
        value.toLowerCase().includes(query),
      ),
    );
  }, [candidateSearch, candidates]);
  const selectedName =
    mode === 'INVITE'
      ? `${invite.firstName.trim()} ${invite.lastName.trim()}`.trim()
      : selected?.name;
  const detailsValid = Boolean(
    invite.firstName.trim() &&
    invite.lastName.trim() &&
    invite.email.trim() &&
    invite.mobileNumber.trim(),
  );
  const configurationValid =
    role === 'CLINIC_SECRETARY'
      ? bundles.length > 0 &&
        (!current && !cancelClinicDay ? true : password.length > 0)
      : Boolean(
          fromDate &&
          toDate &&
          fromDate <= toDate &&
          (coverageMode !== 'ONE_SERVICE_DATE' || fromDate === toDate),
        );
  const toggleBundle = (bundle: string) =>
    setBundles((value) =>
      value.includes(bundle)
        ? value.filter((item) => item !== bundle)
        : [...value, bundle],
    );

  function submit() {
    if (mode === 'INVITE') {
      void onSubmit(
        role === 'CLINIC_SECRETARY'
          ? {
              role: 'INVITE_NEW',
              ...invite,
              assignmentType: role,
              authorityBundles: bundles,
              requestedCancelClinicDay: cancelClinicDay,
              password: current || cancelClinicDay ? password : undefined,
            }
          : {
              role: 'INVITE_NEW',
              ...invite,
              assignmentType: role,
              coverageMode,
              fromServiceDate: fromDate,
              toServiceDate: toDate,
            },
      );
    } else if (selected) {
      const [firstName, ...lastNameParts] = selected.name.trim().split(/\s+/);
      const identity = {
        firstName,
        lastName: lastNameParts.join(' ') || firstName,
        email: selected.email,
        mobileNumber: selected.mobileNumber,
      };
      void onSubmit(
        role === 'CLINIC_SECRETARY'
          ? {
              role,
              userId: selected.userId,
              ...identity,
              authorityBundles: bundles,
              requestedCancelClinicDay: cancelClinicDay,
              password: current || cancelClinicDay ? password : undefined,
            }
          : {
              role,
              userId: selected.userId,
              ...identity,
              coverageMode,
              fromServiceDate: fromDate,
              toServiceDate: toDate,
            },
      );
    }
  }

  return (
    <aside
      className="staff-assignment-drawer"
      aria-label="Assign Secretary drawer"
    >
      <button
        type="button"
        className="staff-drawer-close"
        aria-label="Close Assign Secretary drawer"
        onClick={onClose}
      >
        ×
      </button>
      <span className="staff-drawer-step">{step}</span>
      {step === 1 ? (
        <>
          <h2>Assign Secretary</h2>
          <p>
            Choose how you want to add or assign a Secretary to{' '}
            {data.clinic.name}.
          </p>
          <button
            type="button"
            className="staff-choice-card is-selected"
            onClick={() => {
              setMode('EXISTING');
              setStep(2);
            }}
          >
            <b>Assign Existing Secretary</b>
            <span>
              Assign a Secretary who already has an account in the system.
            </span>
          </button>
          <button
            type="button"
            className="staff-choice-card"
            onClick={() => {
              setMode('INVITE');
              setStep(2);
            }}
          >
            <b>Invite New Secretary</b>
            <span>Send an invitation for a clinic relationship.</span>
          </button>
        </>
      ) : null}
      {step === 2 && mode === 'EXISTING' ? (
        <>
          <h2>Assign Existing Secretary</h2>
          <p>Select a Secretary to assign to {data.clinic.name}.</p>
          <label className="staff-candidate-search">
            Search your existing Secretaries
            <input
              type="search"
              placeholder="Search by name, email or mobile…"
              value={candidateSearch}
              onChange={(event) => setCandidateSearch(event.target.value)}
            />
          </label>
          <div className="staff-candidate-list">
            {visibleCandidates.length ? (
              visibleCandidates.map((candidate) => (
                <button
                  type="button"
                  key={candidate.userId}
                  className={userId === candidate.userId ? 'is-selected' : ''}
                  onClick={() => setUserId(candidate.userId)}
                >
                  <i aria-hidden="true" />
                  <span>
                    <strong>{candidate.name}</strong>
                    <small>{candidate.email}</small>
                    <small>{candidate.mobileNumber}</small>
                  </span>
                </button>
              ))
            ) : (
              <p>
                {candidateSearch.trim()
                  ? 'No existing Secretary relationships match your search.'
                  : 'No eligible existing Secretaries are available.'}
              </p>
            )}
          </div>
        </>
      ) : null}
      {step === 2 && mode === 'INVITE' ? (
        <>
          <h2>Invitation Details</h2>
          <p>
            They will sign in to their own Secretary account, or create and
            verify one through the normal account flow before accepting.
          </p>
          <div className="staff-invite-fields">
            <label>
              First Name
              <input
                value={invite.firstName}
                onChange={(e) =>
                  setInvite({ ...invite, firstName: e.target.value })
                }
              />
            </label>
            <label>
              Last Name
              <input
                value={invite.lastName}
                onChange={(e) =>
                  setInvite({ ...invite, lastName: e.target.value })
                }
              />
            </label>
            <label>
              Email Address
              <input
                type="email"
                value={invite.email}
                onChange={(e) =>
                  setInvite({ ...invite, email: e.target.value })
                }
              />
            </label>
            <label>
              Mobile Number
              <input
                value={invite.mobileNumber}
                onChange={(e) =>
                  setInvite({ ...invite, mobileNumber: e.target.value })
                }
              />
            </label>
          </div>
        </>
      ) : null}
      {step === 3 ? (
        <>
          <h2>Set Assignment Type</h2>
          <p>Choose the type of assignment for {selectedName}.</p>
          <button
            type="button"
            className={`staff-choice-card ${role === 'CLINIC_SECRETARY' ? 'is-selected' : ''}`}
            onClick={() => setRole('CLINIC_SECRETARY')}
          >
            <b>Clinic Secretary</b>
            <span>Assign as the Clinic Secretary for {data.clinic.name}.</span>
          </button>
          <button
            type="button"
            className={`staff-choice-card ${role === 'SUBSTITUTE_SECRETARY' ? 'is-selected' : ''}`}
            onClick={() => setRole('SUBSTITUTE_SECRETARY')}
          >
            <b>Substitute Secretary</b>
            <span>
              Temporary coverage with live clinic and queue authority only
              during covered dates.
            </span>
          </button>
        </>
      ) : null}
      {step === 4 && role === 'CLINIC_SECRETARY' ? (
        <>
          <h2>Set Authority Bundles</h2>
          <p>Select one or more authority bundles.</p>
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
          </div>
          <label className="staff-radio">
            <input
              type="checkbox"
              checked={cancelClinicDay}
              onChange={(e) => setCancelClinicDay(e.target.checked)}
            />{' '}
            Allow Cancel Clinic Day{' '}
            <small>
              Sensitive authority requiring Doctor re-authentication when used.
            </small>
          </label>
          {current ? (
            <div className="staff-replacement-warning">
              <strong>Replace current Clinic Secretary?</strong>
              <p>
                If this invitation is accepted, {selectedName} will replace{' '}
                {current.name} at {data.clinic.name}. {current.name}'s account
                and unrelated clinic assignments remain unaffected.
              </p>
              <label>
                Enter your current password to authorize this replacement intent
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </label>
            </div>
          ) : cancelClinicDay ? (
            <div className="staff-replacement-warning">
              <strong>Sensitive authority</strong>
              <p>
                Cancel Clinic Day can interrupt clinic operations and requires
                fresh Doctor authentication before it is granted.
              </p>
              <label>
                Enter your current password to grant Cancel Clinic Day
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </label>
            </div>
          ) : null}
        </>
      ) : null}
      {step === 4 && role === 'SUBSTITUTE_SECRETARY' ? (
        <>
          <h2>Substitute Secretary Coverage</h2>
          <p>Select the inclusive coverage period for {selectedName}.</p>
          <label className="staff-radio">
            <input
              type="radio"
              checked={coverageMode === 'ONE_SERVICE_DATE'}
              onChange={() => {
                setCoverageMode('ONE_SERVICE_DATE');
                setToDate(fromDate);
              }}
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
                onChange={(e) => {
                  setFromDate(e.target.value);
                  if (coverageMode === 'ONE_SERVICE_DATE')
                    setToDate(e.target.value);
                }}
              />
            </label>
            <label>
              To
              <input
                type="date"
                disabled={coverageMode === 'ONE_SERVICE_DATE'}
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
              />
            </label>
          </div>
          <div className="staff-neutral-note">
            Authority is fixed and limited to live clinic and queue operations
            on covered Clinic Days. The Clinic Secretary remains assigned.
          </div>
        </>
      ) : null}
      {step === 5 ? (
        <>
          <h2>Review Invitation</h2>
          <p>Please review the pending clinic relationship invitation.</p>
          <dl className="staff-review">
            <div>
              <dt>Secretary</dt>
              <dd>{selectedName}</dd>
            </div>
            {mode === 'INVITE' ? (
              <div>
                <dt>Email</dt>
                <dd>{invite.email}</dd>
              </div>
            ) : null}
            <div>
              <dt>Clinic</dt>
              <dd>{data.clinic.name}</dd>
            </div>
            <div>
              <dt>Assignment Type</dt>
              <dd>
                {role === 'CLINIC_SECRETARY'
                  ? 'Clinic Secretary'
                  : 'Substitute Secretary'}
              </dd>
            </div>
            {role === 'CLINIC_SECRETARY' ? (
              <div>
                <dt>Authority Bundles</dt>
                <dd>
                  {bundles
                    .map(
                      (bundle) =>
                        AUTHORITY_BUNDLES.find(
                          ([value]) => value === bundle,
                        )?.[1],
                    )
                    .join(', ')}
                </dd>
              </div>
            ) : (
              <div>
                <dt>Coverage Period</dt>
                <dd>
                  {fromDate} – {toDate}
                </dd>
              </div>
            )}
          </dl>
          <div className="staff-neutral-note">
            No clinic authority is granted until the eligible Secretary accepts
            this invitation.
          </div>
        </>
      ) : null}
      {message ? (
        <div className="staff-drawer-message" role="status">
          {message}
        </div>
      ) : null}
      <footer>
        <button
          type="button"
          onClick={step === 1 ? onClose : () => setStep((value) => value - 1)}
        >
          {step === 1 ? 'Cancel' : 'Back'}
        </button>
        {step < 5 ? (
          <button
            type="button"
            className="is-primary"
            disabled={
              (step === 2 && (mode === 'EXISTING' ? !userId : !detailsValid)) ||
              (step === 4 && !configurationValid)
            }
            onClick={() => setStep((value) => value + 1)}
          >
            Next
          </button>
        ) : (
          <button
            type="button"
            className="is-primary"
            disabled={pending}
            onClick={submit}
          >
            {pending ? 'Sending…' : 'Send Invitation'}
          </button>
        )}
      </footer>
    </aside>
  );
}
