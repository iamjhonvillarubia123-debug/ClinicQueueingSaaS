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

type DraftPayload = {
  mode: 'INDIVIDUAL';
  firstName: string;
  middleName?: string;
  lastName: string;
  suffix?: string;
  existingPatientResponse: 'YES' | 'NO' | 'UNSURE';
  mobileNumber: string;
  serviceDate: string;
  privacyNoticeVersion: string;
  privacyNoticeAcknowledged: true;
  scheduledReminderOptIn: boolean;
  selectedServiceIds: string[];
  answers: DraftAnswer[];
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

type ConfirmationResult = {
  appointment: { bookingReference: string; queueNumber: number; serviceDate: string; status: string };
  bookingAccessToken: { expiresAt: string; transport: 'HTTP_ONLY_COOKIE' };
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
  return <header className="public-header"><Link className="brand" to="/">Clinic Queueing</Link><Link className="quiet-link" to="/login">Staff sign in</Link></header>;
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

export function IndividualBookingPage() {
  const { publicIdentifier } = useParams();
  const navigate = useNavigate();
  const [config, setConfig] = useState<BookingConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [stage, setStage] = useState<Stage>('details');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<DraftResult | null>(null);
  const [payload, setPayload] = useState<DraftPayload | null>(null);
  const [confirmation, setConfirmation] = useState<ConfirmationResult | null>(null);
  const [replacementSession, setReplacementSession] = useState<ReplacementSession | null>(null);
  const [duplicateContext, setDuplicateContext] = useState<DuplicateContext | null>(null);
  const [draftReplacementAuthorized, setDraftReplacementAuthorized] = useState(false);
  const [otp, setOtp] = useState('');
  const [serviceDate, setServiceDate] = useState('');
  const [selectedServices, setSelectedServices] = useState<string[]>([]);
  const [firstName, setFirstName] = useState('');
  const [middleName, setMiddleName] = useState('');
  const [lastName, setLastName] = useState('');
  const [suffix, setSuffix] = useState('');
  const [existingPatientResponse, setExistingPatientResponse] = useState<'YES' | 'NO' | 'UNSURE'>('UNSURE');
  const [mobileNumber, setMobileNumber] = useState('');
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [privacyAcknowledged, setPrivacyAcknowledged] = useState(false);
  const [scheduledReminderOptIn, setScheduledReminderOptIn] = useState(false);

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

  const selectedServiceRows = useMemo(
    () => config?.services.filter((service) => selectedServices.includes(service.id)) ?? [],
    [config, selectedServices],
  );

  function preparedAnswers(): DraftAnswer[] {
    if (!config) return [];
    const result: DraftAnswer[] = [];
    for (const question of config.bookingQuestions) {
      const raw = answers[question.id]?.trim() ?? '';
      if (!raw) continue;
      if (question.type === 'TEXT') result.push({ bookingQuestionId: question.id, answerText: raw });
      else if (question.type === 'NUMBER') result.push({ bookingQuestionId: question.id, answerNumber: Number(raw) });
      else if (question.type === 'BOOLEAN') result.push({ bookingQuestionId: question.id, answerBoolean: raw === 'true' });
      else result.push({ bookingQuestionId: question.id, selectedOptionValue: raw });
    }
    return result;
  }

  function makePayload(): DraftPayload | null {
    if (!config || !serviceDate || !firstName.trim() || !lastName.trim() || !mobileNumber.trim() || selectedServices.length === 0 || !privacyAcknowledged) return null;
    const prepared = preparedAnswers();
    const answeredIds = new Set(prepared.map((answer) => answer.bookingQuestionId));
    if (config.bookingQuestions.some((question) => question.isRequired && !answeredIds.has(question.id))) return null;
    return {
      mode: 'INDIVIDUAL',
      firstName: firstName.trim(), middleName: middleName.trim() || undefined,
      lastName: lastName.trim(), suffix: suffix.trim() || undefined,
      existingPatientResponse, mobileNumber: mobileNumber.trim(), serviceDate,
      privacyNoticeVersion: PRIVACY_NOTICE_VERSION, privacyNoticeAcknowledged: true,
      scheduledReminderOptIn, selectedServiceIds: selectedServices, answers: prepared,
    };
  }

  async function submitDetails(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!publicIdentifier) return;
    setError('');
    const nextPayload = makePayload();
    if (!nextPayload) { setError('Complete the required booking details before continuing.'); return; }
    setBusy(true);
    try {
      const availability = await apiRequest<{ availableForPublicBooking: boolean }>(`/booking/public/availability/${encodeURIComponent(publicIdentifier)}/${encodeURIComponent(serviceDate)}`);
      if (!availability.availableForPublicBooking) { setError('That date is not currently available for online booking. Please choose another date.'); return; }

      if (replacementSession && !draft) {
        setPayload(nextPayload);
        setStage('review');
        return;
      }

      let nextDraft: DraftResult;
      if (draft) {
        await apiRequest(`/booking/public/draft/${encodeURIComponent(publicIdentifier)}/${encodeURIComponent(draft.bookingDraft.id)}`, {
          method: 'PUT', body: { ...nextPayload, draftControlToken: draft.draftControlToken },
        });
        const reissued = await apiRequest<{ otpVerification: DraftResult['otpVerification'] }>(`/booking/draft/${encodeURIComponent(draft.bookingDraft.id)}/request-otp`, {
          method: 'POST', body: { draftControlToken: draft.draftControlToken },
        });
        nextDraft = { ...draft, otpVerification: reissued.otpVerification };
      } else {
        nextDraft = await apiRequest<DraftResult>(`/booking/public/draft/${encodeURIComponent(publicIdentifier)}`, { method: 'POST', body: nextPayload });
      }
      if (!nextDraft.otpVerification) { setError('The booking is not ready for mobile verification. Review the required information.'); return; }
      setDraft(nextDraft);
      setPayload(nextPayload);
      setDuplicateContext(null);
      setDraftReplacementAuthorized(false);
      sessionStorage.setItem(`booking-draft:${nextDraft.bookingDraft.id}`, nextDraft.draftControlToken);
      setOtp('');
      setStage('otp');
    } catch (caught) { setError(messageFor(caught)); }
    finally { setBusy(false); }
  }

  async function verifyOtp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft) return;
    setError('');
    if (!/^\d{6}$/.test(otp)) { setError('Enter the 6-digit verification code.'); return; }
    setBusy(true);
    try {
      await apiRequest('/booking/verify-otp', { method: 'POST', body: { bookingDraftId: draft.bookingDraft.id, otp } });
      const duplicate = await apiRequest<DuplicateContextResult>(`/booking/draft/${encodeURIComponent(draft.bookingDraft.id)}/duplicate-context`, { method: 'POST' });
      if (duplicate.duplicate) {
        setDuplicateContext(duplicate.context);
        setStage('duplicate');
      } else {
        setStage('review');
      }
    } catch (caught) { setError(messageFor(caught)); }
    finally { setBusy(false); }
  }

  async function resendOtp() {
    if (!draft) return;
    setError(''); setBusy(true);
    try {
      await apiRequest(`/booking/draft/${encodeURIComponent(draft.bookingDraft.id)}/request-otp`, { method: 'POST', body: { draftControlToken: draft.draftControlToken } });
      setOtp('');
    } catch (caught) { setError(messageFor(caught)); }
    finally { setBusy(false); }
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
    } catch (caught) { setError(messageFor(caught)); }
    finally { setBusy(false); }
  }

  async function authorizeDraftReplacement() {
    if (!draft || !duplicateContext || busy) return;
    setError(''); setBusy(true);
    try {
      const result = await apiRequest<{ replacementAuthorized: boolean }>(`/booking/draft/${encodeURIComponent(draft.bookingDraft.id)}/replace-existing`, { method: 'POST' });
      if (!result.replacementAuthorized) throw new Error('Replacement authorization could not be completed.');
      setDraftReplacementAuthorized(true);
      setStage('review');
    } catch (caught) { setError(messageFor(caught)); }
    finally { setBusy(false); }
  }

  async function confirm() {
    if ((!draft && !replacementSession) || !publicIdentifier || !payload) return;
    setError(''); setBusy(true);
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
      const result = await apiRequest<ConfirmationResult>(`/booking/draft/${encodeURIComponent(draftToConfirm.bookingDraft.id)}/confirm`, {
        method: 'POST', headers: { 'Idempotency-Key': crypto.randomUUID() },
      });
      sessionStorage.removeItem(`booking-draft:${draftToConfirm.bookingDraft.id}`);
      if (replacementSession) {
        sessionStorage.removeItem(`f4-replacement:${publicIdentifier}`);
        setReplacementSession(null);
      }
      setConfirmation(result);
      setStage('confirmed');
    } catch (caught) { setError(messageFor(caught)); }
    finally { setBusy(false); }
  }

  function toggleService(serviceId: string, checked: boolean) {
    if (!config) return;
    setSelectedServices((current) => checked
      ? current.length < config.serviceSelection.maximumSelections ? [...current, serviceId] : current
      : current.filter((id) => id !== serviceId));
  }

  if (loading) return <main className="public-detail"><PublicHeader /><section className="public-state" aria-live="polite"><p className="eyebrow">Booking</p><h1>Loading clinic booking…</h1></section></main>;
  if (!config || !publicIdentifier) return <main className="public-detail"><PublicHeader /><section className="public-state"><p className="eyebrow">Booking unavailable</p><h1>We cannot start this booking.</h1><p>{error || 'This clinic is not currently available for online booking.'}</p><Link className="secondary-action" to="/">Return home</Link></section></main>;

  return <main className="public-detail"><PublicHeader /><article className="booking-flow">
    <div className="booking-progress" aria-label="Booking progress"><span className={stage === 'details' ? 'current' : ''}>Details</span>{!replacementSession ? <span className={stage === 'otp' ? 'current' : ''}>Verify</span> : null}{stage === 'duplicate' || stage === 'duplicate-replace-confirm' ? <span className="current">Resolve</span> : null}<span className={stage === 'review' ? 'current' : ''}>Review</span><span className={stage === 'confirmed' ? 'current' : ''}>Confirmed</span></div>

    {stage === 'details' && <>
      <header className="booking-heading"><p className="eyebrow">{replacementSession ? 'Replacement booking' : 'Individual booking'}</p><h1>Book at {config.practiceLocation.name}</h1><p>{replacementSession ? 'Create the new booking that will replace the booking you just cancelled.' : 'Choose a date and services, then enter the patient details needed for this appointment.'}</p></header>
      <form className="booking-form" onSubmit={submitDetails}>
        <section className="form-section"><h2>Date and services</h2><label>Service date<input type="date" required readOnly={Boolean(replacementSession)} value={serviceDate} onChange={(event) => setServiceDate(event.target.value)} /></label>{replacementSession ? <p className="field-note">This replacement is verified for {formatServiceDate(serviceDate)}.</p> : <p className="field-note">Online booking is available only on dates accepted by the clinic, up to {config.bookingWindow.maximumAdvanceBookingDays} days ahead.</p>}<fieldset><legend>Services <span>Choose up to {config.serviceSelection.maximumSelections}</span></legend><div className="choice-list">{config.services.map((service) => <label className="choice-row" key={service.id}><input type="checkbox" checked={selectedServices.includes(service.id)} onChange={(event) => toggleService(service.id, event.target.checked)} /><span><strong>{service.name}</strong><small>{service.durationMinutes} min</small></span></label>)}</div></fieldset></section>

        <section className="form-section"><h2>Patient details</h2><div className="field-grid"><label>First name<input required maxLength={100} value={firstName} onChange={(event) => setFirstName(event.target.value)} /></label><label>Middle name <span className="optional">Optional</span><input maxLength={100} value={middleName} onChange={(event) => setMiddleName(event.target.value)} /></label><label>Last name<input required maxLength={100} value={lastName} onChange={(event) => setLastName(event.target.value)} /></label><label>Suffix <span className="optional">Optional</span><input maxLength={20} value={suffix} onChange={(event) => setSuffix(event.target.value)} /></label></div><label>Have you been a patient at this clinic before?<select value={existingPatientResponse} onChange={(event) => setExistingPatientResponse(event.target.value as 'YES' | 'NO' | 'UNSURE')}><option value="YES">Yes</option><option value="NO">No</option><option value="UNSURE">Not sure</option></select></label><label>Mobile number<input type="tel" inputMode="tel" autoComplete="tel" required maxLength={30} readOnly={Boolean(replacementSession)} placeholder="09… or +63…" value={mobileNumber} onChange={(event) => setMobileNumber(event.target.value)} /></label><p className="field-note">{replacementSession ? 'This is the verified mobile number for the replacement.' : 'We use this number for booking verification and necessary appointment messages.'}</p></section>

        {config.bookingQuestions.length > 0 && <section className="form-section"><h2>Clinic questions</h2>{config.bookingQuestions.map((question) => <label key={question.id}>{question.questionText}{!question.isRequired && <span className="optional"> Optional</span>}{question.helpText && <small className="help-text">{question.helpText}</small>}{question.type === 'TEXT' ? <textarea required={question.isRequired} maxLength={question.textMaximumLength ?? 10000} value={answers[question.id] ?? ''} onChange={(event) => setAnswers((current) => ({ ...current, [question.id]: event.target.value }))} /> : question.type === 'NUMBER' ? <input type="number" required={question.isRequired} min={question.numberMinimum ?? undefined} max={question.numberMaximum ?? undefined} value={answers[question.id] ?? ''} onChange={(event) => setAnswers((current) => ({ ...current, [question.id]: event.target.value }))} /> : question.type === 'BOOLEAN' ? <select required={question.isRequired} value={answers[question.id] ?? ''} onChange={(event) => setAnswers((current) => ({ ...current, [question.id]: event.target.value }))}><option value="">Choose</option><option value="true">Yes</option><option value="false">No</option></select> : <select required={question.isRequired} value={answers[question.id] ?? ''} onChange={(event) => setAnswers((current) => ({ ...current, [question.id]: event.target.value }))}><option value="">Choose</option>{selectValues(question.selectOptions).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>}</label>)}</section>}

        <section className="form-section"><h2>Privacy and communication</h2><label className="check-line"><input type="checkbox" checked={privacyAcknowledged} onChange={(event) => setPrivacyAcknowledged(event.target.checked)} /><span>I have read and acknowledge the Privacy Notice ({PRIVACY_NOTICE_VERSION}) and understand that necessary operational messages may be sent for this booking.</span></label><label className="check-line"><input type="checkbox" checked={scheduledReminderOptIn} onChange={(event) => setScheduledReminderOptIn(event.target.checked)} /><span>I may receive an optional future reminder from the clinic. This is optional and separate from messages needed for this appointment.</span></label></section>
        {error && <div className="form-error" role="alert">{error}</div>}<div className="form-actions"><Link className="secondary-action" to={`/public/practice-locations/${encodeURIComponent(publicIdentifier)}`}>Back to clinic</Link><button className="primary" type="submit" disabled={busy}>{busy ? 'Checking…' : replacementSession ? 'Review new booking' : draft ? 'Save changes and verify again' : 'Continue to verification'}</button></div>
      </form>
    </>}

    {stage === 'otp' && <section className="booking-narrow"><p className="eyebrow">Mobile verification</p><h1>Enter the 6-digit code</h1><p>We sent a booking verification code to the mobile number you provided. Codes expire after five minutes.</p><form className="stack" onSubmit={verifyOtp}><label>Verification code<input className="otp-input" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={otp} onChange={(event) => setOtp(event.target.value.replace(/\D/g, '').slice(0, 6))} /></label>{error && <div className="form-error" role="alert">{error}</div>}<button className="primary" type="submit" disabled={busy || otp.length !== 6}>{busy ? 'Verifying…' : 'Verify code'}</button><button className="secondary" type="button" disabled={busy} onClick={resendOtp}>Send a new code</button><button className="text-button" type="button" onClick={() => { setError(''); setStage('details'); }}>Change booking details</button></form></section>}

    {stage === 'duplicate' && duplicateContext ? <DuplicateBookingDecision context={duplicateContext} error={error} busy={busy} onUseExisting={() => void useExistingDuplicate()} onNeedDifferent={() => { setError(''); setStage('duplicate-replace-confirm'); }} /> : null}

    {stage === 'duplicate-replace-confirm' && duplicateContext ? <DuplicateReplacementConfirmation context={duplicateContext} error={error} busy={busy} onBack={() => { setError(''); setStage('duplicate'); }} onConfirmReplacement={() => void authorizeDraftReplacement()} /> : null}

    {stage === 'review' && payload && <section className="booking-narrow"><p className="eyebrow">Review</p><h1>Check your booking</h1><div className="review-list"><div><span>Clinic</span><strong>{config.practiceLocation.name}</strong></div><div><span>Date</span><strong>{formatServiceDate(payload.serviceDate)}</strong></div><div><span>Patient</span><strong>{[payload.firstName, payload.middleName, payload.lastName, payload.suffix].filter(Boolean).join(' ')}</strong></div><div><span>Services</span><strong>{selectedServiceRows.map((service) => service.name).join(', ')}</strong></div><div><span>Mobile</span><strong>{payload.mobileNumber}</strong></div></div>{error && <div className="form-error" role="alert">{error}</div>}<div className="form-actions stacked-actions"><button className="primary" type="button" disabled={busy} onClick={confirm}>{busy ? 'Confirming…' : replacementSession || draftReplacementAuthorized ? 'Confirm new appointment' : 'Confirm appointment'}</button>{!draftReplacementAuthorized && !(replacementSession && draft) ? <button className="secondary" type="button" onClick={() => { setError(''); setStage('details'); }}>Edit booking</button> : null}</div><p className="field-note">{replacementSession || draftReplacementAuthorized ? 'No second verification code is required. The new Queue Number is assigned only after successful confirmation.' : 'Availability and clinic rules are checked again when you confirm. Your queue number is assigned only after successful confirmation.'}</p></section>}

    {stage === 'confirmed' && confirmation && <section className="booking-narrow confirmed-panel"><p className="eyebrow">Confirmed</p><h1>Your appointment is booked.</h1><div className="queue-confirmation"><span>Queue number</span><strong>{confirmation.appointment.queueNumber}</strong></div><div className="review-list"><div><span>Booking reference</span><strong>{confirmation.appointment.bookingReference}</strong></div><div><span>Service date</span><strong>{formatServiceDate(String(confirmation.appointment.serviceDate))}</strong></div></div><Link className="primary-action full-action" to={`/patient-bookings/${encodeURIComponent(confirmation.appointment.bookingReference)}`}>View appointment</Link><p className="field-note">Keep this booking available on this device. Access is protected by a secure browser cookie rather than a token shown in the URL.</p></section>}
  </article></main>;
}
