import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ApiError, apiRequest } from '../api/client';
import {
  DuplicateBookingDecision,
  DuplicateReplacementConfirmation,
  type DuplicateContext,
  type DuplicateContextResult,
  type UseExistingResult,
} from './DuplicateBookingResolution';
import '../styles/booking.css';

const PRIVACY_NOTICE_VERSION = 'v1.0-2026-08';
const MIN_MEMBERS = 2;
const MAX_MEMBERS = 5;

type BookingQuestion = {
  id: string;
  questionText: string;
  helpText: string | null;
  type: 'TEXT' | 'NUMBER' | 'BOOLEAN' | 'SINGLE_SELECT';
  isRequired: boolean;
  textMaximumLength: number | null;
  numberMinimum: number | string | null;
  numberMaximum: number | string | null;
  selectOptions: unknown;
};

type BookingConfig = {
  practiceLocation: { publicIdentifier: string; name: string; timeZone: string };
  bookingWindow: { maximumAdvanceBookingDays: number; upperBoundaryInclusive: boolean };
  services: Array<{ id: string; name: string; durationMinutes: number }>;
  bookingQuestions: BookingQuestion[];
  serviceSelection: { maximumSelections: number };
};

type DraftAnswer = {
  bookingQuestionId: string;
  answerText?: string;
  answerNumber?: number;
  answerBoolean?: boolean;
  selectedOptionValue?: string;
};

type MemberForm = {
  key: string;
  firstName: string;
  middleName: string;
  lastName: string;
  suffix: string;
  existingPatientResponse: 'YES' | 'NO' | 'UNSURE';
  selectedServiceIds: string[];
  answers: Record<string, string>;
};

type MemberPayload = {
  firstName: string;
  middleName?: string;
  lastName: string;
  suffix?: string;
  existingPatientResponse: 'YES' | 'NO' | 'UNSURE';
  selectedServiceIds: string[];
  answers: DraftAnswer[];
};

type GroupDraftPayload = {
  mode: 'MULTI_PERSON';
  mobileNumber: string;
  serviceDate: string;
  privacyNoticeVersion: string;
  privacyNoticeAcknowledged: true;
  scheduledReminderOptIn: boolean;
  members: MemberPayload[];
};

type DraftResult = {
  bookingDraft: { id: string; bookingReference: string; expiresAt: string };
  draftControlToken: string;
  otpVerification: null | {
    id?: string;
    expiresAt: string;
    maxAttempts?: number;
    verified?: boolean;
    replacementAuthorized?: boolean;
  };
};

type GroupConfirmation = {
  bookingGroup: {
    serviceDate: string;
    appointments: Array<{
      bookingReference: string;
      queueNumber: number;
      status: string;
      firstName: string | null;
      lastName: string | null;
    }>;
  };
  bookingGroupAccessToken: { expiresAt: string; transport: 'HTTP_ONLY_COOKIE' } | null;
  replayed: boolean;
};

type ReplacementSession = {
  recoveryAttemptId: string;
  serviceDate: string;
  mobileNumber: string;
  expiresAt: string;
};

type Stage = 'details' | 'otp' | 'duplicate' | 'duplicate-replace-confirm' | 'review' | 'confirmed';

function PublicHeader() {
  return (
    <header className="public-header">
      <Link className="brand" to="/">Clinic Queueing</Link>
      <Link className="quiet-link" to="/login">Staff sign in</Link>
    </header>
  );
}

function messageFor(error: unknown) {
  return error instanceof ApiError ? error.message : 'Something went wrong. Please try again.';
}

function readReplacementSession(publicIdentifier: string): ReplacementSession | null {
  const key = `f4-replacement:${publicIdentifier}`;
  const raw = sessionStorage.getItem(key);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<ReplacementSession>;
    if (!parsed.recoveryAttemptId || !parsed.serviceDate || !parsed.mobileNumber || !parsed.expiresAt) {
      sessionStorage.removeItem(key);
      return null;
    }
    if (new Date(parsed.expiresAt).getTime() <= Date.now()) {
      sessionStorage.removeItem(key);
      return null;
    }
    return parsed as ReplacementSession;
  } catch {
    sessionStorage.removeItem(key);
    return null;
  }
}

function formatServiceDate(value: string) {
  const [year, month, day] = value.slice(0, 10).split('-');
  return year && month && day ? `${month}/${day}/${year}` : value;
}

function newMember(): MemberForm {
  return {
    key: crypto.randomUUID(),
    firstName: '',
    middleName: '',
    lastName: '',
    suffix: '',
    existingPatientResponse: 'UNSURE',
    selectedServiceIds: [],
    answers: {},
  };
}

function selectValues(value: unknown): Array<{ value: string; label: string }> {
  if (!Array.isArray(value)) return [];
  const options: Array<{ value: string; label: string }> = [];
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item) || !('value' in item) || typeof item.value !== 'string') continue;
    const label = 'label' in item && typeof item.label === 'string' ? item.label : item.value;
    options.push({ value: item.value, label });
  }
  return options;
}

function answersFor(member: MemberForm, questions: BookingQuestion[]): DraftAnswer[] {
  const answers: DraftAnswer[] = [];
  for (const question of questions) {
    const raw = member.answers[question.id]?.trim() ?? '';
    if (!raw) continue;
    if (question.type === 'TEXT') answers.push({ bookingQuestionId: question.id, answerText: raw });
    else if (question.type === 'NUMBER') answers.push({ bookingQuestionId: question.id, answerNumber: Number(raw) });
    else if (question.type === 'BOOLEAN') answers.push({ bookingQuestionId: question.id, answerBoolean: raw === 'true' });
    else answers.push({ bookingQuestionId: question.id, selectedOptionValue: raw });
  }
  return answers;
}

export function MultiPersonBookingPage() {
  const { publicIdentifier } = useParams();
  const navigate = useNavigate();
  const [config, setConfig] = useState<BookingConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [stage, setStage] = useState<Stage>('details');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [serviceDate, setServiceDate] = useState('');
  const [mobileNumber, setMobileNumber] = useState('');
  const [members, setMembers] = useState<MemberForm[]>([newMember(), newMember()]);
  const [privacyAcknowledged, setPrivacyAcknowledged] = useState(false);
  const [scheduledReminderOptIn, setScheduledReminderOptIn] = useState(false);
  const [draft, setDraft] = useState<DraftResult | null>(null);
  const [payload, setPayload] = useState<GroupDraftPayload | null>(null);
  const [otp, setOtp] = useState('');
  const [confirmation, setConfirmation] = useState<GroupConfirmation | null>(null);
  const [replacementSession, setReplacementSession] = useState<ReplacementSession | null>(null);
  const [duplicateContext, setDuplicateContext] = useState<DuplicateContext | null>(null);
  const [draftReplacementAuthorized, setDraftReplacementAuthorized] = useState(false);

  useEffect(() => {
    let active = true;
    if (!publicIdentifier) { setLoading(false); return; }
    const replacement = readReplacementSession(publicIdentifier);
    if (replacement) {
      setReplacementSession(replacement);
      setServiceDate(replacement.serviceDate);
      setMobileNumber(replacement.mobileNumber);
    }
    void apiRequest<BookingConfig>(`/booking/public/configuration/${encodeURIComponent(publicIdentifier)}`)
      .then((result) => { if (active) setConfig(result); })
      .catch((caught) => { if (active) setError(messageFor(caught)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [publicIdentifier]);

  const memberNames = useMemo(
    () => members.map((member) => [member.firstName, member.lastName].filter(Boolean).join(' ').trim()),
    [members],
  );

  function patchMember(index: number, patch: Partial<MemberForm>) {
    setMembers((current) => current.map((member, memberIndex) => memberIndex === index ? { ...member, ...patch } : member));
  }

  function toggleService(index: number, serviceId: string, checked: boolean) {
    if (!config) return;
    const member = members[index];
    if (!member) return;
    const next = checked
      ? member.selectedServiceIds.length < config.serviceSelection.maximumSelections
        ? [...member.selectedServiceIds, serviceId]
        : member.selectedServiceIds
      : member.selectedServiceIds.filter((id) => id !== serviceId);
    patchMember(index, { selectedServiceIds: next });
  }

  function makePayload(): GroupDraftPayload | null {
    if (!config || !serviceDate || !mobileNumber.trim() || !privacyAcknowledged) return null;
    if (members.length < MIN_MEMBERS || members.length > MAX_MEMBERS) return null;

    const prepared: MemberPayload[] = [];
    for (const member of members) {
      if (!member.firstName.trim() || !member.lastName.trim() || member.selectedServiceIds.length === 0) return null;
      const answers = answersFor(member, config.bookingQuestions);
      const answeredIds = new Set(answers.map((answer) => answer.bookingQuestionId));
      if (config.bookingQuestions.some((question) => question.isRequired && !answeredIds.has(question.id))) return null;
      prepared.push({
        firstName: member.firstName.trim(),
        middleName: member.middleName.trim() || undefined,
        lastName: member.lastName.trim(),
        suffix: member.suffix.trim() || undefined,
        existingPatientResponse: member.existingPatientResponse,
        selectedServiceIds: member.selectedServiceIds,
        answers,
      });
    }

    return {
      mode: 'MULTI_PERSON',
      mobileNumber: mobileNumber.trim(),
      serviceDate,
      privacyNoticeVersion: PRIVACY_NOTICE_VERSION,
      privacyNoticeAcknowledged: true,
      scheduledReminderOptIn,
      members: prepared,
    };
  }

  async function submitDetails(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!publicIdentifier) return;
    setError('');
    const nextPayload = makePayload();
    if (!nextPayload) {
      setError('Complete the required details, Services, and clinic questions for every person before continuing.');
      return;
    }

    setBusy(true);
    try {
      const availability = await apiRequest<{ availableForPublicBooking: boolean }>(`/booking/public/availability/${encodeURIComponent(publicIdentifier)}/${encodeURIComponent(serviceDate)}`);
      if (!availability.availableForPublicBooking) {
        setError('That date is not currently available for online booking. Please choose another date.');
        return;
      }
      if (replacementSession && !draft) {
        setPayload(nextPayload);
        setStage('review');
        return;
      }
      const nextDraft = await apiRequest<DraftResult>(`/booking/public/draft/${encodeURIComponent(publicIdentifier)}`, {
        method: 'POST',
        body: nextPayload,
      });
      if (!nextDraft.otpVerification) {
        setError('The group booking is not ready for mobile verification. Review every member’s required information.');
        return;
      }
      setDraft(nextDraft);
      setPayload(nextPayload);
      setDuplicateContext(null);
      setDraftReplacementAuthorized(false);
      sessionStorage.setItem(`booking-draft:${nextDraft.bookingDraft.id}`, nextDraft.draftControlToken);
      setOtp('');
      setStage('otp');
    } catch (caught) {
      setError(messageFor(caught));
    } finally {
      setBusy(false);
    }
  }

  async function verifyOtp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft) return;
    setError('');
    if (!/^\d{6}$/.test(otp)) {
      setError('Enter the 6-digit verification code.');
      return;
    }
    setBusy(true);
    try {
      await apiRequest('/booking/verify-otp', {
        method: 'POST',
        body: { bookingDraftId: draft.bookingDraft.id, otp },
      });
      const duplicate = await apiRequest<DuplicateContextResult>(`/booking/draft/${encodeURIComponent(draft.bookingDraft.id)}/duplicate-context`, { method: 'POST' });
      if (duplicate.duplicate) {
        setDuplicateContext(duplicate.context);
        setStage('duplicate');
      } else {
        setStage('review');
      }
    } catch (caught) {
      setError(messageFor(caught));
    } finally {
      setBusy(false);
    }
  }

  async function resendOtp() {
    if (!draft) return;
    setError('');
    setBusy(true);
    try {
      await apiRequest(`/booking/draft/${encodeURIComponent(draft.bookingDraft.id)}/request-otp`, {
        method: 'POST',
        body: { draftControlToken: draft.draftControlToken },
      });
      setOtp('');
    } catch (caught) {
      setError(messageFor(caught));
    } finally {
      setBusy(false);
    }
  }

  async function useExistingDuplicate() {
    if (!draft || !duplicateContext || busy) return;
    setError(''); setBusy(true);
    try {
      const result = await apiRequest<UseExistingResult>(`/booking/draft/${encodeURIComponent(draft.bookingDraft.id)}/use-existing`, { method: 'POST' });
      sessionStorage.removeItem(`booking-draft:${draft.bookingDraft.id}`);
      if (result.contextKind === 'BOOKING_GROUP') {
        navigate('/patient-booking-groups', { replace: true });
      } else {
        navigate(`/patient-bookings/${encodeURIComponent(result.bookingReference)}`, { replace: true });
      }
    } catch (caught) {
      setError(messageFor(caught));
    } finally {
      setBusy(false);
    }
  }

  async function authorizeDraftReplacement() {
    if (!draft || !duplicateContext || busy) return;
    setError(''); setBusy(true);
    try {
      const result = await apiRequest<{ replacementAuthorized: boolean }>(`/booking/draft/${encodeURIComponent(draft.bookingDraft.id)}/replace-existing`, { method: 'POST' });
      if (!result.replacementAuthorized) throw new Error('Replacement authorization could not be completed.');
      setDraftReplacementAuthorized(true);
      setStage('review');
    } catch (caught) {
      setError(messageFor(caught));
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    if ((!draft && !replacementSession) || !publicIdentifier || !payload) return;
    setError('');
    setBusy(true);
    try {
      let draftToConfirm = draft;
      if (!draftToConfirm && replacementSession) {
        draftToConfirm = await apiRequest<DraftResult>(`/booking/public/draft/${encodeURIComponent(publicIdentifier)}`, {
          method: 'POST',
          body: { ...payload, replacementRecoveryAttemptId: replacementSession.recoveryAttemptId },
        });
        if (!draftToConfirm.otpVerification?.verified || !draftToConfirm.otpVerification.replacementAuthorized) {
          throw new Error('Replacement verification is no longer valid.');
        }
        setDraft(draftToConfirm);
        sessionStorage.setItem(`booking-draft:${draftToConfirm.bookingDraft.id}`, draftToConfirm.draftControlToken);
      }
      if (!draftToConfirm) return;
      const result = await apiRequest<GroupConfirmation>(`/booking/draft/${encodeURIComponent(draftToConfirm.bookingDraft.id)}/confirm`, {
        method: 'POST',
        headers: { 'Idempotency-Key': crypto.randomUUID() },
      });
      sessionStorage.removeItem(`booking-draft:${draftToConfirm.bookingDraft.id}`);
      if (replacementSession) {
        sessionStorage.removeItem(`f4-replacement:${publicIdentifier}`);
        setReplacementSession(null);
      }
      setConfirmation(result);
      setStage('confirmed');
    } catch (caught) {
      setError(messageFor(caught));
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return <main className="public-detail"><PublicHeader /><section className="public-state" aria-live="polite"><p className="eyebrow">Group booking</p><h1>Loading clinic booking…</h1></section></main>;
  }
  if (!config || !publicIdentifier) {
    return <main className="public-detail"><PublicHeader /><section className="public-state"><p className="eyebrow">Booking unavailable</p><h1>We cannot start this group booking.</h1><p>{error || 'This clinic is not currently available for online booking.'}</p><Link className="secondary-action" to="/">Return home</Link></section></main>;
  }

  return (
    <main className="public-detail">
      <PublicHeader />
      <article className="booking-flow">
        <div className="booking-progress" aria-label="Booking progress">
          <span className={stage === 'details' ? 'current' : ''}>People</span>
          {!replacementSession ? <span className={stage === 'otp' ? 'current' : ''}>Verify</span> : null}
          {stage === 'duplicate' || stage === 'duplicate-replace-confirm' ? <span className="current">Resolve</span> : null}
          <span className={stage === 'review' ? 'current' : ''}>Review</span>
          <span className={stage === 'confirmed' ? 'current' : ''}>Confirmed</span>
        </div>

        {stage === 'details' && (
          <>
            <header className="booking-heading">
              <p className="eyebrow">{replacementSession ? 'Replacement group booking' : 'Multi-person booking'}</p>
              <h1>Book 2–5 people at {config.practiceLocation.name}</h1>
              <p>{replacementSession ? 'Create the new group booking that will replace the booking you just cancelled.' : 'One mobile number controls this booking. Each person keeps their own Services, clinic answers, Appointment, and Queue Number.'}</p>
              <Link className="quiet-link" to={`/book/${encodeURIComponent(publicIdentifier)}`}>Book one person instead</Link>
            </header>

            <form className="booking-form" onSubmit={submitDetails}>
              <section className="form-section">
                <h2>Shared booking details</h2>
                <label>Service date<input type="date" required readOnly={Boolean(replacementSession)} value={serviceDate} onChange={(event) => setServiceDate(event.target.value)} /></label>
                <p className="field-note">{replacementSession ? `This replacement is verified for ${formatServiceDate(serviceDate)}.` : `All members share the same clinic and service date. Online booking is limited to dates accepted by the clinic, up to ${config.bookingWindow.maximumAdvanceBookingDays} days ahead.`}</p>
                <label>Controlling mobile number<input type="tel" inputMode="tel" autoComplete="tel" required maxLength={30} readOnly={Boolean(replacementSession)} placeholder="09… or +63…" value={mobileNumber} onChange={(event) => setMobileNumber(event.target.value)} /></label>
                <p className="field-note">{replacementSession ? 'This is the verified controlling mobile for the replacement.' : 'One verification code is sent for the whole group. This number controls later group access; it is not copied as each member’s personal mobile.'}</p>
              </section>

              {members.map((member, index) => (
                <section className="form-section member-section" key={member.key}>
                  <div className="section-heading-row">
                    <div><p className="eyebrow">Person {index + 1}</p><h2>{memberNames[index] || `Person ${index + 1}`}</h2></div>
                    {members.length > MIN_MEMBERS ? <button className="secondary" type="button" onClick={() => setMembers((current) => current.filter((_, memberIndex) => memberIndex !== index))}>Remove</button> : null}
                  </div>
                  <div className="field-grid">
                    <label>First name<input required maxLength={100} value={member.firstName} onChange={(event) => patchMember(index, { firstName: event.target.value })} /></label>
                    <label>Middle name <span className="optional">Optional</span><input maxLength={100} value={member.middleName} onChange={(event) => patchMember(index, { middleName: event.target.value })} /></label>
                    <label>Last name<input required maxLength={100} value={member.lastName} onChange={(event) => patchMember(index, { lastName: event.target.value })} /></label>
                    <label>Suffix <span className="optional">Optional</span><input maxLength={20} value={member.suffix} onChange={(event) => patchMember(index, { suffix: event.target.value })} /></label>
                  </div>
                  <label>Has this person been a patient at this clinic before?
                    <select value={member.existingPatientResponse} onChange={(event) => patchMember(index, { existingPatientResponse: event.target.value as MemberForm['existingPatientResponse'] })}>
                      <option value="YES">Yes</option><option value="NO">No</option><option value="UNSURE">Not sure</option>
                    </select>
                  </label>
                  <fieldset>
                    <legend>Services <span>Choose up to {config.serviceSelection.maximumSelections}</span></legend>
                    <div className="choice-list">
                      {config.services.map((service) => (
                        <label className="choice-row" key={service.id}>
                          <input type="checkbox" checked={member.selectedServiceIds.includes(service.id)} onChange={(event) => toggleService(index, service.id, event.target.checked)} />
                          <span><strong>{service.name}</strong><small>{service.durationMinutes} min</small></span>
                        </label>
                      ))}
                    </div>
                  </fieldset>
                  {config.bookingQuestions.length > 0 ? (
                    <div className="member-questions">
                      <h3>Clinic questions</h3>
                      {config.bookingQuestions.map((question) => (
                        <label key={question.id}>{question.questionText}{!question.isRequired && <span className="optional"> Optional</span>}{question.helpText && <small className="help-text">{question.helpText}</small>}
                          {question.type === 'TEXT' ? <textarea required={question.isRequired} maxLength={question.textMaximumLength ?? 10000} value={member.answers[question.id] ?? ''} onChange={(event) => patchMember(index, { answers: { ...member.answers, [question.id]: event.target.value } })} />
                            : question.type === 'NUMBER' ? <input type="number" required={question.isRequired} min={question.numberMinimum ?? undefined} max={question.numberMaximum ?? undefined} value={member.answers[question.id] ?? ''} onChange={(event) => patchMember(index, { answers: { ...member.answers, [question.id]: event.target.value } })} />
                            : question.type === 'BOOLEAN' ? <select required={question.isRequired} value={member.answers[question.id] ?? ''} onChange={(event) => patchMember(index, { answers: { ...member.answers, [question.id]: event.target.value } })}><option value="">Choose</option><option value="true">Yes</option><option value="false">No</option></select>
                            : <select required={question.isRequired} value={member.answers[question.id] ?? ''} onChange={(event) => patchMember(index, { answers: { ...member.answers, [question.id]: event.target.value } })}><option value="">Choose</option>{selectValues(question.selectOptions).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>}
                        </label>
                      ))}
                    </div>
                  ) : null}
                </section>
              ))}

              {members.length < MAX_MEMBERS ? <button className="secondary wide-action" type="button" onClick={() => setMembers((current) => [...current, newMember()])}>Add another person</button> : null}

              <section className="form-section">
                <h2>Privacy and communication</h2>
                <label className="check-line"><input type="checkbox" checked={privacyAcknowledged} onChange={(event) => setPrivacyAcknowledged(event.target.checked)} /><span>I have read and acknowledge the Privacy Notice ({PRIVACY_NOTICE_VERSION}) for this booking and understand that necessary operational messages may be sent to the controlling mobile.</span></label>
                <label className="check-line"><input type="checkbox" checked={scheduledReminderOptIn} onChange={(event) => setScheduledReminderOptIn(event.target.checked)} /><span>Send optional future booking reminders to the controlling mobile.</span></label>
              </section>

              {error ? <div className="form-error" role="alert">{error}</div> : null}
              <button className="primary wide-action" disabled={busy} type="submit">{busy ? 'Checking booking…' : replacementSession ? 'Review new group booking' : 'Continue to verification'}</button>
            </form>
          </>
        )}

        {stage === 'otp' && draft ? (
          <section className="booking-stage">
            <p className="eyebrow">Verify controlling mobile</p>
            <h1>Enter the 6-digit code</h1>
            <p>One verification confirms temporary control of the submitted mobile for this group booking. It does not establish identity or relationship between members.</p>
            <form className="booking-form" onSubmit={verifyOtp}>
              <label>Verification code<input inputMode="numeric" autoComplete="one-time-code" maxLength={6} pattern="[0-9]{6}" value={otp} onChange={(event) => setOtp(event.target.value.replace(/\D/g, '').slice(0, 6))} /></label>
              {error ? <div className="form-error" role="alert">{error}</div> : null}
              <button className="primary wide-action" disabled={busy || otp.length !== 6} type="submit">{busy ? 'Verifying…' : 'Verify code'}</button>
              <button className="secondary wide-action" disabled={busy} type="button" onClick={resendOtp}>Resend code</button>
            </form>
          </section>
        ) : null}

        {stage === 'duplicate' && duplicateContext ? <DuplicateBookingDecision context={duplicateContext} error={error} busy={busy} onUseExisting={() => void useExistingDuplicate()} onNeedDifferent={() => { setError(''); setStage('duplicate-replace-confirm'); }} /> : null}

        {stage === 'duplicate-replace-confirm' && duplicateContext ? <DuplicateReplacementConfirmation context={duplicateContext} error={error} busy={busy} onBack={() => { setError(''); setStage('duplicate'); }} onConfirmReplacement={() => void authorizeDraftReplacement()} /> : null}

        {stage === 'review' && payload ? (
          <section className="booking-stage">
            <p className="eyebrow">Review group booking</p>
            <h1>Check all {payload.members.length} people</h1>
            <div className="review-list">
              <div><span>Clinic</span><strong>{config.practiceLocation.name}</strong></div>
              <div><span>Service date</span><strong>{formatServiceDate(payload.serviceDate)}</strong></div>
              <div><span>Controlling mobile</span><strong>{payload.mobileNumber}</strong></div>
            </div>
            <div className="group-review-members">
              {payload.members.map((member, index) => (
                <article className="review-member" key={`${member.firstName}-${member.lastName}-${index}`}>
                  <p className="eyebrow">Person {index + 1}</p>
                  <h2>{member.firstName} {member.lastName}</h2>
                  <p>{member.selectedServiceIds.length} Service{member.selectedServiceIds.length === 1 ? '' : 's'} selected</p>
                </article>
              ))}
            </div>
            <p className="field-note">{replacementSession || draftReplacementAuthorized ? 'No second verification code is required. Confirmation rechecks clinic rules and capacity, and fresh Queue Numbers are assigned only after successful confirmation.' : 'Confirmation rechecks current clinic rules and capacity for the whole group. The booking succeeds as one transaction or not at all. Each person receives an independent permanent Queue Number only after successful confirmation.'}</p>
            {error ? <div className="form-error" role="alert">{error}</div> : null}
            <button className="primary wide-action" disabled={busy} type="button" onClick={confirm}>{busy ? 'Confirming group…' : replacementSession || draftReplacementAuthorized ? 'Confirm new group booking' : 'Confirm group booking'}</button>
            {replacementSession && !draft ? <button className="secondary wide-action" disabled={busy} type="button" onClick={() => { setError(''); setStage('details'); }}>Edit booking</button> : null}
          </section>
        ) : null}

        {stage === 'confirmed' && confirmation ? (
          <section className="booking-stage confirmation-stage">
            <p className="eyebrow">Confirmed</p>
            <h1>Your group booking is confirmed.</h1>
            <p>Each person has their own Appointment, Booking Reference, and permanent Queue Number.</p>
            <div className="group-confirmation-list">
              {confirmation.bookingGroup.appointments.map((appointment) => (
                <article className="confirmation-member" key={appointment.bookingReference}>
                  <span>Queue {appointment.queueNumber}</span>
                  <strong>{[appointment.firstName, appointment.lastName].filter(Boolean).join(' ')}</strong>
                  <small>{appointment.bookingReference}</small>
                </article>
              ))}
            </div>
            <Link className="primary-action" to="/patient-booking-groups">View group booking</Link>
          </section>
        ) : null}
      </article>
    </main>
  );
}

export function BookingGroupAccessBoundary() {
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [dashboard, setDashboard] = useState<null | {
    serviceDate: string;
    visibleMemberCount: number;
    members: Array<{ bookingReference: string; queueNumber: number; status: string; firstName: string | null; lastName: string | null }>;
  }>(null);

  useEffect(() => {
    let active = true;
    void apiRequest<typeof dashboard>('/patient-booking-groups/dashboard')
      .then((result) => { if (active) { setDashboard(result); setState('ready'); } })
      .catch(() => { if (active) setState('error'); });
    return () => { active = false; };
  }, []);

  if (state === 'loading') return <main className="public-detail"><PublicHeader /><section className="public-state"><p className="eyebrow">Group booking</p><h1>Loading your group…</h1></section></main>;
  if (state === 'error' || !dashboard) return <main className="public-detail"><PublicHeader /><section className="public-state"><p className="eyebrow">Group access unavailable</p><h1>We cannot open this group booking on this device.</h1><p>Use the valid controller access or recovery journey for this group.</p><Link className="secondary-action" to="/">Return home</Link></section></main>;

  return (
    <main className="public-detail">
      <PublicHeader />
      <article className="booking-flow">
        <header className="booking-heading"><p className="eyebrow">Group booking</p><h1>{dashboard.visibleMemberCount} confirmed people</h1><p>Detailed live queue controls are added in the next patient-experience milestone. This device has valid controller access to the group.</p></header>
        <div className="group-confirmation-list">
          {dashboard.members.map((member) => <article className="confirmation-member" key={member.bookingReference}><span>Queue {member.queueNumber}</span><strong>{[member.firstName, member.lastName].filter(Boolean).join(' ')}</strong><small>{member.bookingReference}</small></article>)}
        </div>
      </article>
    </main>
  );
}
