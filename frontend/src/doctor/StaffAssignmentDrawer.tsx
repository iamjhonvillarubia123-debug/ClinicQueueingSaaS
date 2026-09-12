import { CoverageScheduleEditor } from './CoverageScheduleEditor';
import type { CoverageRange } from './coverage-ranges';
import { invitationRanges, overlaps, subtractCoverage, formatCoverage } from './coverage-ranges';
import { Drawer } from './settings/SettingsShared';
import { useMemo, useState } from 'react';
import type { AuthoritativeClinicStaff } from './AuthoritativeClinicStaffTab';

export const AUTHORITY_BUNDLES = [
  ['QUEUE_AND_CLINIC_DAY_OPERATIONS', 'Queue & Clinic Day Operations'],
  ['APPOINTMENTS_AND_PATIENT_INTAKE', 'Appointments & Patient Intake'],
  ['CLINIC_CONFIGURATION_DRAFTING', 'Clinic Configuration Drafting'],
  ['REPORTS_VIEW_ONLY', 'Reports · View Only'],
] as const;

const AUTHORITY_BUNDLE_DETAILS: Record<string, string[]> = {
  QUEUE_AND_CLINIC_DAY_OPERATIONS: [
    'Delayed Opening',
    'Start Clinic',
    'Call Again',
    'Next Patient',
    'Staff Reinsert',
    'Return to Queue',
    'Undo',
    'Close Clinic',
  ],
  APPOINTMENTS_AND_PATIENT_INTAKE: ['Add Walk-in / Appointment'],
  CLINIC_CONFIGURATION_DRAFTING: [
    'Prepare Draft',
    'Edit Draft',
    'Submit for Doctor Approval',
  ],
  REPORTS_VIEW_ONLY: ['View Reports'],
};

function invitationIdentifierLooksValid(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (trimmed.includes('@')) return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
  const compact = trimmed.replace(/[\s()-]/g, '');
  return /^(?:\+63|63|0)?9\d{9}$/.test(compact);
}

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
      identifier: string;
      assignmentType: 'CLINIC_SECRETARY';
      replacePendingInvitationIds?: string[];
      authorityBundles: string[];
      requestedCancelClinicDay: boolean;
      password?: string;
    }
  | {
      role: 'INVITE_NEW';
      identifier: string;
      assignmentType: 'SUBSTITUTE_SECRETARY';
      coverageRanges?: CoverageRange[];
      replacePendingInvitationIds?: string[];
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
  onValidateInviteIdentifier,
  onValidateInviteAuthorization,
}: {
  data: AuthoritativeClinicStaff;
  pending: boolean;
  message: string;
  onClose: () => void;
  onSubmit: (command: StaffAssignmentCommand) => void | Promise<void>;
  onValidateInviteIdentifier?: (
    identifier: string,
  ) => Promise<{ existingSecretary: boolean; secretaryName: string | null }>;
  onValidateInviteAuthorization?: (password: string) => Promise<void>;
}) {
  const current = data.staffAssignments.find(
    (staff) => staff.isClinicSecretary && staff.assignmentActive,
  );
  const candidates = data.candidates;
  const [step, setStep] = useState(1);
  const [mode, setMode] = useState<'EXISTING' | 'INVITE'>('EXISTING');
  const [userId, setUserId] = useState(candidates[0]?.userId ?? '');
  const [candidateSearch, setCandidateSearch] = useState('');
  const [role, setRole] = useState<'CLINIC_SECRETARY' | 'SUBSTITUTE_SECRETARY'>(
    'CLINIC_SECRETARY',
  );
  const [bundles, setBundles] = useState<string[]>([AUTHORITY_BUNDLES[0][0]]);
  const [expandedBundle, setExpandedBundle] = useState<string | null>(null);
  const [cancelClinicDay, setCancelClinicDay] = useState(false);
  const [coverageRanges, setCoverageRanges] = useState<CoverageRange[]>([]);
  const fromDate = coverageRanges[0]?.fromServiceDate ?? '';
  const toDate = coverageRanges.at(-1)?.toServiceDate ?? '';
  const coverageMode = fromDate === toDate ? 'ONE_SERVICE_DATE' : 'DATE_RANGE';
  const [password, setPassword] = useState('');
  const [showReplacementReview, setShowReplacementReview] = useState(false);
  const [reviewedReplacement, setReviewedReplacement] = useState('');
  const [inviteIdentifier, setInviteIdentifier] = useState('');
  const [stepValidationPending, setStepValidationPending] = useState(false);
  const [stepValidationError, setStepValidationError] = useState('');
  const [, setValidatedInvitee] = useState<{ existingSecretary: boolean; secretaryName: string | null } | null>(null);

  const selected = candidates.find((candidate) => candidate.userId === userId);
  const resolvedIdentifier = mode === 'INVITE' ? inviteIdentifier.trim() : (selected?.identifier ?? selected?.email ?? selected?.mobileNumber ?? '');
  const visibleCandidates = useMemo(() => {
    const query = candidateSearch.trim().toLowerCase();
    if (!query) return candidates;
    return candidates.filter((candidate) =>
      [candidate.name, candidate.email, candidate.mobileNumber].some((value) =>
        (value ?? '').toLowerCase().includes(query),
      ),
    );
  }, [candidateSearch, candidates]);

  const pendingClinicInvitations = data.pendingInvitations.filter((invitation) => invitation.assignmentType === 'CLINIC_SECRETARY' && new Date(invitation.expiresAt).getTime() > Date.now());
  const selectedCoverage = coverageRanges;
  const overlapsSelected = (ranges: CoverageRange[]) => selectedCoverage.some((range) => overlaps(ranges, range));
  const subtractSelected = (ranges: CoverageRange[]) => selectedCoverage.reduce((result, range) => subtractCoverage(result, range), ranges);
  const pendingCoverageChanges = data.pendingInvitations.filter((invitation) => invitation.assignmentType === 'SUBSTITUTE_SECRETARY' && new Date(invitation.expiresAt).getTime() > Date.now() && overlapsSelected(invitationRanges(invitation))).map((invitation) => ({ invitation, remaining: subtractSelected(invitationRanges(invitation)) }));
  const activeCoverageChanges = data.staffAssignments.map((staff) => {
    const ranges = staff.substituteCoverages.filter((coverage) => coverage.status === 'ACTIVE').map((coverage) => ({ fromServiceDate: coverage.fromServiceDate.slice(0, 10), toServiceDate: coverage.toServiceDate.slice(0, 10) }));
    return { staff, ranges, remaining: subtractSelected(ranges) };
  }).filter((item) => overlapsSelected(item.ranges));
  const replacementKey = role === 'CLINIC_SECRETARY'
    ? JSON.stringify([current?.practiceStaffId ?? null, ...pendingClinicInvitations.map((invitation) => invitation.invitationId).sort()])
    : JSON.stringify([selectedCoverage, pendingCoverageChanges.map(({ invitation }) => [invitation.invitationId, invitationRanges(invitation)]), activeCoverageChanges.map(({ staff, ranges }) => [staff.practiceStaffId, ranges])]);
  const needsReplacementReview = (role === 'CLINIC_SECRETARY' ? Boolean(current || pendingClinicInvitations.length) : Boolean(pendingCoverageChanges.length || activeCoverageChanges.length));
  const selectedName = mode === 'INVITE' ? 'this Secretary' : selected?.name;
  const detailsValid = Boolean(inviteIdentifier.trim());
  const inviteIdentifierValid =
    invitationIdentifierLooksValid(resolvedIdentifier);
  const sensitiveDoctorAuthorization =
    role === 'CLINIC_SECRETARY' && Boolean(current || cancelClinicDay);
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
  const messageIsError = Boolean(
    message && !message.toLowerCase().includes('successfully'),
  );
  const identifierCorrectionVisible = Boolean(
    mode === 'INVITE' &&
    step === 5 &&
    messageIsError &&
    (!inviteIdentifierValid ||
      message.toLowerCase().includes('identifier') ||
      message.toLowerCase().includes('email') ||
      message.toLowerCase().includes('mobile')),
  );
  const passwordCorrectionVisible = Boolean(
    step === 5 &&
    sensitiveDoctorAuthorization &&
    messageIsError &&
    message.toLowerCase().includes('password'),
  );

  const toggleBundle = (bundle: string) =>
    setBundles((value) =>
      value.includes(bundle)
        ? value.filter((item) => item !== bundle)
        : [...value, bundle],
    );

  async function advance() {
    setStepValidationError('');
    if (step === (role === 'CLINIC_SECRETARY' ? 3 : 4) && needsReplacementReview && reviewedReplacement !== replacementKey) { setShowReplacementReview(true); return; }
    if (step === 2 && onValidateInviteIdentifier) {
      setStepValidationPending(true);
      try {
        const result = await onValidateInviteIdentifier(
          resolvedIdentifier.toLowerCase(),
        );
        setValidatedInvitee(result);
        setStep(3);
      } catch (cause) {
        setValidatedInvitee(null);
        setStepValidationError(
          cause instanceof Error
            ? cause.message
            : 'Unable to validate this Secretary identifier.',
        );
      } finally {
        setStepValidationPending(false);
      }
      return;
    }

    if (
      step === 4 &&
      role === 'CLINIC_SECRETARY' &&
      (current || cancelClinicDay) &&
      onValidateInviteAuthorization
    ) {
      setStepValidationPending(true);
      try {
        await onValidateInviteAuthorization(password);
        setStep(5);
      } catch (cause) {
        setStepValidationError(
          cause instanceof Error
            ? cause.message
            : 'Unable to validate the Doctor password.',
        );
      } finally {
        setStepValidationPending(false);
      }
      return;
    }

    setStep((value) => value + 1);
  }

  function submit() {
    {
      const identifier = resolvedIdentifier;
      void onSubmit(
        role === 'CLINIC_SECRETARY'
          ? {
              role: 'INVITE_NEW',
              identifier,
              assignmentType: role,
              replacePendingInvitationIds: reviewedReplacement === replacementKey ? pendingClinicInvitations.map((invitation) => invitation.invitationId) : [],
              authorityBundles: bundles,
              requestedCancelClinicDay: cancelClinicDay,
              password: current || cancelClinicDay ? password : undefined,
            }
          : {
              role: 'INVITE_NEW',
              identifier,
              assignmentType: role,
              replacePendingInvitationIds: reviewedReplacement === replacementKey ? pendingCoverageChanges.map(({ invitation }) => invitation.invitationId) : [],
              coverageMode,
              coverageRanges,
              fromServiceDate: fromDate,
              toServiceDate: toDate,
            },
      );
    }
  }

  if (showReplacementReview) return <Drawer title={role === 'CLINIC_SECRETARY' ? "Review Clinic Secretary Replacement" : "Review Substitute Coverage Replacement"} onClose={() => setShowReplacementReview(false)}>
    {role === 'SUBSTITUTE_SECRETARY' ? <><p>New coverage: {formatCoverage(selectedCoverage)}</p>{pendingCoverageChanges.map(({ invitation, remaining }) => <section key={invitation.invitationId}><h3>{remaining.length ? 'Revise pending coverage' : 'Cancel pending invitation'}</h3><p>{invitation.name || invitation.email || invitation.mobileNumber}: {remaining.length ? `Sending the new invitation removes the overlapping dates. This invitation stays pending for ${formatCoverage(remaining)}.` : 'All remaining dates are covered by the new invitation. Sending it will cancel this pending invitation.'}</p></section>)}{activeCoverageChanges.map(({ staff, remaining }) => <section key={staff.practiceStaffId}><h3>{remaining.length || staff.isClinicSecretary ? 'Revise active coverage on acceptance' : 'Disable clinic access on acceptance'}</h3><p>{staff.name}: {remaining.length ? `After the new Secretary accepts, coverage remains for ${formatCoverage(remaining)}.` : staff.isClinicSecretary ? 'All substitute coverage is replaced on acceptance. Their Clinic Secretary assignment remains active.' : 'All coverage is replaced. After the new Secretary accepts, this Secretary will be Disabled at this clinic. Their account remains active.'}</p></section>)}</> : null}
    {role === 'CLINIC_SECRETARY' && pendingClinicInvitations.length ? <><h3>Replace pending invitation?</h3><p>Sending the new invitation will cancel the pending invitation for {pendingClinicInvitations.map((invitation) => invitation.name || invitation.email || invitation.mobileNumber || 'the invited Secretary').join(', ')}. They will no longer be able to accept it.</p></> : null}
    {role === 'CLINIC_SECRETARY' && current ? <><h3>Replace current Clinic Secretary?</h3><p>{current.name} will remain active at this clinic until the new Secretary accepts. On acceptance, their assignment will be marked Disabled at this clinic. Their account remains active.</p></> : null}
    <p>No changes are made until you finish reviewing and send the new invitation.</p>
    <footer><button type="button" onClick={() => setShowReplacementReview(false)}>Go Back</button><button type="button" className="ds-primary" onClick={() => { setReviewedReplacement(replacementKey); setShowReplacementReview(false); setStep(role === 'CLINIC_SECRETARY' ? 4 : 5); }}>Continue with Replacement</button></footer>
  </Drawer>;

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
              Choose a connected Secretary, including those disabled at a clinic, and send an invitation.
            </span>
          </button>
          <button
            type="button"
            className="staff-choice-card"
            aria-label="Invite New Secretary to Clinic"
            onClick={() => {
              setMode('INVITE');
              setStep(2);
            }}
          >
            <b>Invite Secretary to Clinic</b>
            <span>
              Send a clinic invitation. If no account exists yet, the recipient
              creates and verifies their own Secretary account first.
            </span>
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
            Enter the Secretary&apos;s email address or Philippine mobile
            number. If no Secretary account exists yet, the invitation will
            direct the recipient to create and verify their own account first.
          </p>
          <div className="staff-invite-fields">
            <label>
              Secretary Email or Mobile Number
              <input
                type="text"
                autoComplete="username"
                inputMode="text"
                placeholder="Email or 09xx xxx xxxx"
                value={inviteIdentifier}
                onChange={(event) => setInviteIdentifier(event.target.value)}
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
            {AUTHORITY_BUNDLES.map(([value, label]) => {
              const expanded = expandedBundle === value;
              return (
                <div className="staff-bundle-item" key={value}>
                  <div className="staff-bundle-row">
                    <label>
                      <input
                        type="checkbox"
                        checked={bundles.includes(value)}
                        onChange={() => toggleBundle(value)}
                      />
                      <strong>{label}</strong>
                    </label>
                    <button
                      type="button"
                      className="staff-bundle-expand"
                      aria-expanded={expanded}
                      aria-label={`${expanded ? 'Hide' : 'Show'} ${label} authority`}
                      onClick={() => setExpandedBundle(expanded ? null : value)}
                    >
                      {expanded ? '⌃' : '⌄'}
                    </button>
                  </div>
                  {expanded ? (
                    <div className="staff-bundle-details">
                      {AUTHORITY_BUNDLE_DETAILS[value].map((detail) => (
                        <span key={detail}>
                          <b
                            aria-hidden="true"
                            style={{ color: '#168337', marginRight: 6 }}
                          >
                            ✓
                          </b>
                          {detail}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
          <label className="staff-radio">
            <input
              type="checkbox"
              checked={cancelClinicDay}
              onChange={(event) => setCancelClinicDay(event.target.checked)}
            />{' '}
            Allow Cancel Clinic Day
            <small>
              Sensitive authority requiring Doctor re-authentication when used.
            </small>
          </label>
          {current ? (
            <div className="staff-replacement-warning">
              <strong>Replace current Clinic Secretary?</strong>
              <p>
                {`If this invitation is accepted, the invited Secretary will replace ${current.name} at ${data.clinic.name}.`}{' '}
                {current.name}&apos;s account and unrelated clinic assignments
                remain unaffected.
              </p>
              <label>
                Enter your current password to authorize this replacement
                <input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
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
                  onChange={(event) => setPassword(event.target.value)}
                />
              </label>
            </div>
          ) : null}
        </>
      ) : null}

      {step === 4 && role === 'SUBSTITUTE_SECRETARY' ? (
        <>
          <h2>Substitute Secretary Coverage</h2>
          <CoverageScheduleEditor initialRanges={coverageRanges} onChange={setCoverageRanges} />
          <div className="staff-neutral-note">
            Authority is fixed and limited to live clinic and queue operations
            on covered Clinic Days. The Clinic Secretary remains assigned.
          </div>
        </>
      ) : null}

      {step === 5 ? (
        <>
          <h2>
            {'Review Invitation'}
          </h2>
          <p>
            Review the invitation. Roles, access, and coverage change only after the Secretary accepts.
          </p>
          <dl className="staff-review">
            {mode === 'INVITE' ? (
              <div>
                <dt>Secretary Email or Mobile Number</dt>
                <dd>{inviteIdentifier.trim()}</dd>
              </div>
            ) : (
              <div>
                <dt>Secretary</dt>
                <dd>{selectedName}</dd>
              </div>
            )}
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
                  {formatCoverage(coverageRanges)}
                </dd>
              </div>
            )}
          </dl>
          <div className="staff-neutral-note">
            The Secretary must accept this invitation before their clinic assignment or coverage changes. Their existing account and sign-in details stay the same.
          </div>
        </>
      ) : null}

      {step === 5 && role === 'CLINIC_SECRETARY' && needsReplacementReview && pendingClinicInvitations.length ? <div className="staff-replacement-warning">Sending this invitation cancels the pending Clinic Secretary invitation you reviewed. Any active Clinic Secretary remains assigned until the new invitation is accepted.</div> : null}
      {step === 5 && role === 'SUBSTITUTE_SECRETARY' && needsReplacementReview ? <div className="staff-replacement-warning">Sending revises the pending invitations you reviewed, cancelling only those with no remaining dates. Active coverage changes only after acceptance.</div> : null}
      {stepValidationError ? (
        <div className="staff-drawer-message is-error" role="alert">
          {stepValidationError}
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

      {identifierCorrectionVisible ? (
        <div className="staff-invite-fields">
          <label>
            Secretary Email or Mobile Number
            <input
              type="text"
              autoComplete="username"
              inputMode="text"
              value={inviteIdentifier}
              onChange={(event) => setInviteIdentifier(event.target.value)}
            />
          </label>
          <button
            type="button"
            className="clinic-staff-primary-button is-full"
            disabled={pending || !inviteIdentifier.trim()}
            onClick={submit}
          >
            {pending ? 'Retrying…' : 'Retry Invitation'}
          </button>
        </div>
      ) : null}

      {passwordCorrectionVisible ? (
        <div className="staff-replacement-warning">
          <strong>Doctor authorization failed</strong>
          <label>
            Enter your current password again
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          <button
            type="button"
            className="clinic-staff-primary-button is-full"
            disabled={pending || !password}
            onClick={submit}
          >
            {pending ? 'Retrying…' : 'Retry Doctor authorization'}
          </button>
        </div>
      ) : null}

      {mode === 'INVITE' && step === 5 && !inviteIdentifierValid ? (
        <div className="staff-drawer-message is-error" role="alert">
          Enter a valid email address or Philippine mobile number.
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
            onClick={() => void advance()}
          >
            Next
          </button>
        ) : !identifierCorrectionVisible ? (
          <button
            type="button"
            className="is-primary"
            disabled={pending || stepValidationPending || (needsReplacementReview && reviewedReplacement !== replacementKey)}
            onClick={submit}
          >
            {pending || stepValidationPending ? 'Sending…' : 'Send Invitation'}
          </button>
        ) : null}
      </footer>
    </aside>
  );
}
