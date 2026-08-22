import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ApiError, apiRequest } from '../api/client';

const PRIVACY_NOTICE_VERSION = 'v1.0-2026-08';

type BookingQuestion = {
  id: string;
  questionText: string;
  helpText: string | null;
  type: 'TEXT' | 'NUMBER' | 'BOOLEAN' | 'SINGLE_SELECT';
  isRequired: boolean;
  displayOrder: number;
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
  otpVerification: null | { id: string; expiresAt: string; maxAttempts: number };
};

type ConfirmationResult = {
  appointment: { bookingReference: string; queueNumber: number; serviceDate: string; status: string };
  bookingAccessToken: { expiresAt: string; transport: 'HTTP_ONLY_COOKIE' };
  replayed: boolean;
};

type Stage = 'details' | 'otp' | 'review' | 'confirmed';

function PublicHeader() {
  return <header className="public-header"><Link className="brand" to="/">Clinic Queueing</Link><Link className="quiet-link" to="/login">Staff sign in</Link></header>;
}

function errorMessage(error: unknown) {
  return error instanceof ApiError ? error.message : 'Something went wrong. Please try again.';
}

function selectValues(options: unknown) {
  if (!Array.isArray(options)) return [];
  return options.flatMap((option) => {
    if (!option || typeof option !== 'object' || Array.isArray(option)) return [];
    const value = 'value' in option && typeof option.value === 'string' ? option.value : null;
    if (!value) return [];
    const label = 'label' in option && typeof option.label === 'string' ? option.label : value;
    return [{ value, label }];
  });
}

export function IndividualBookingPage() {
  const { publicIdentifier } = useParams();
  const [config, setConfig] = useState<BookingConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [stage, setStage] = useState<Stage>('details');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<DraftResult | null>(null);
  const [payload, setPayload] = useState<DraftPayload | null>(null);
  const [otp, setOtp] = useState('');
  const [confirmation, setConfirmation] = useState<ConfirmationResult | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [selectedServices, setSelectedServices] = useState<string[]>([]);
  const [serviceDate, setServiceDate] = useState('');
  const [firstName, setFirstName] = useState('');
  const [middleName, setMiddleName] = useState('');
  const [lastName, setLastName] = useState('');
  const [suffix, setSuffix] = useState('');
  const [existingPatientResponse, setExistingPatientResponse] = useState<'YES' | 'NO' | 'UNSURE'>('UNSURE');
  const [mobileNumber, setMobileNumber] = useState('');
  const [privacyAcknowledged, setPrivacyAcknowledged] = useState(false);
  const [scheduledReminderOptIn, setScheduledReminderOptIn] = useState(false);

  useEffect(() => {
    let active = true;
    if (!publicIdentifier) { setLoading(false); return; }
    void apiRequest<BookingConfig>(`/booking/public/configuration/${encodeURIComponent(publicIdentifier)}`)
      .then((result) => { if (active) setConfig(result); })
      .catch((caught) => { if (active) setError(errorMessage(caught)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [publicIdentifier]);

  const selectedServiceRows = useMemo(() => config?.services.filter((service) => selectedServices.includes(service.id)) ?? [], [config, selectedServices]);

  function buildAnswers(): DraftAnswer[] {
    if (!config) return [];
    return config.bookingQuestions.flatMap((question) => {
      const raw = answers[question.id]?.trim() ?? '';
      if (!raw) return [];
      if (question.type === 'TEXT') return [{ bookingQuestionId: question.id, answerText: raw }];
      if (question.type === 'NUMBER') return [{ bookingQuestionId: question.id, answerNumber: Number(raw) }];
      if (question.type === 'BOOLEAN') return [{ bookingQuestionId: question.id, answerBoolean: raw === 'true' }];
      return [{ bookingQuestionId: question.id, selectedOptionValue: raw }];
    });
  }

  function buildPayload(): DraftPayload | null {
    if (!config || !serviceDate || !firstName.trim() || !lastName.trim() || !mobileNumber.trim() || selectedServices.length === 0 || !privacyAcknowledged) return null;
    const preparedAnswers = buildAnswers();
    const answered = new Set(preparedAnswers.map((answer) => answer.bookingQuestionId));
    if (config.bookingQuestions.some((question) => question.isRequired && !answered.has(question.id))) return null;
    return {
      mode: 'INDIVIDUAL', firstName: firstName.trim(), middleName: middleName.trim() || undefined, lastName: lastName.trim(), suffix: suffix.trim() || undefined,
      existingPatientResponse, mobileNumber: mobileNumber.trim(), serviceDate, privacyNoticeVersion: PRIVACY_NOTICE_VERSION,
      privacyNoticeAcknowledged: true, scheduledReminderOptIn, selectedServiceIds: selectedServices, answers: preparedAnswers,
    };
  }

  async function submitDetails(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!publicIdentifier) return;
    setError('');
    const nextPayload = buildPayload();
    if (!nextPayload) { setError('Complete the required booking details before continuing.'); return; }
    setBusy(true);
    try {
      const availability = await apiRequest<{ availableForPublicBooking: boolean }>(`/booking/public/availability/${encodeURIComponent(publicIdentifier)}/${encodeURIComponent(serviceDate)}`);
      if (!availability.availableForPublicBooking) { setError('That date is not currently available for online booking. Please choose another date.'); return; }

      let result: DraftResult;
      if (draft) {
        result = await apiRequest<DraftResult>(`/booking/public/draft/${encodeURIComponent(publicIdentifier)}/${encodeURIComponent(draft.bookingDraft.id)}`, {
          method: 'PUT', body: { ...nextPayload, draftControlToken: draft.draftControlToken },
        });
        await apiRequest(`/booking/draft/${encodeURIComponent(draft.bookingDraft.id)}/request-otp`, { method: 'POST', body: { draftControlToken: draft.draftControlToken } });
        result = { ...draft, otpVerification: { id: 'reissued', expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(), maxAttempts: 5 } };
      } else {
        result = await apiRequest<DraftResult>(`/booking/public/draft/${encodeURIComponent(publicIdentifier)}`, { method: 'POST', body: nextPayload });
      }
      if (!result.otpVerification) { setError('The booking is not ready for mobile verification. Review the required information.'); return; }
      setDraft(result);
      setPayload(nextPayload);
      sessionStorage.setItem(`booking-draft:${result.bookingDraft.id}`, result.draftControlToken);
      setOtp('');
      setStage('otp');
    } catch (caught) {
      setError(errorMessage(caught));
    } finally { setBusy(false); }
  }

  async function verifyOtp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft) return;
    setError('');
    if (!/^\d{6}$/.test(otp)) { setError('Enter the 6-digit verification code.'); return; }
    setBusy(true);
    try {
      await apiRequest('/booking/verify-otp', { method: 'POST', body: { bookingDraftId: draft.bookingDraft.id, otp } });
      setStage('review');
    } catch (caught) { setError(errorMessage(caught)); }
    finally { setBusy(false); }
  }

  async function resendOtp() {
    if (!draft) return;
    setError(''); setBusy(true);
    try {
      await apiRequest(`/booking/draft/${encodeURIComponent(draft.bookingDraft.id)}/request-otp`, { method: 'POST', body: { draftControlToken: draft.draftControlToken } });
      setOtp('');
    } catch (caught) { setError(errorMessage(caught)); }
    finally { setBusy(false); }
  }

  async function confirm() {
    if (!draft) return;
    setError(''); setBusy(true);
    try {
      const result = await apiRequest<ConfirmationResult>(`/booking/draft/${encodeURIComponent(draft.bookingDraft.id)}/confirm`, {
        method: 'POST', headers: { 'Idempotency-Key': crypto.randomUUID() },
      });
      sessionStorage.removeItem(`booking-draft:${draft.bookingDraft.id}`);
      setConfirmation(result);
      setStage('confirmed');
    } catch (caught) { setError(errorMessage(caught)); }
    finally { setBusy(false); }
  }

  if (loading) return <main className="public-detail"><PublicHeader /><section className="public-state" aria-live="polite"><p className="eyebrow">Booking</p><h1>Loading clinic booking…</h1></section></main>;
  if (!config || !publicIdentifier) return <main className="public-detail"><PublicHeader /><section className="public-state"><p className="eyebrow">Booking unavailable</p><h1>We cannot start this booking.</h1><p>{error || 'This clinic is not currently available for online booking.'}</p><Link className="secondary-action" to="/">Return home</Link></section></main>;

  return <main className="public-detail"><PublicHeader /><article className="booking-flow">
    <div className="booking-progress" aria-label="Booking progress"><span className={stage === 'details' ? 'current' : ''}>Details</span><span className={stage === 'otp' ? 'current' : ''}>Verify</span><span className={stage === 'review' ? 'current' : ''}>Review</span><span className={stage === 'confirmed' ? 'current' : ''}>Confirmed</span></div>

    {stage === 'details' ? <>
      <header className="booking-heading"><p className="eyebrow">Individual booking</p><h1>Book at {config.practiceLocation.name}</h1><p>Choose a date and services, then enter the patient details needed for this appointment.</p></header>
      <form className="booking-form" onSubmit={submitDetails}>
        <section className="form-section"><h2>Date and services</h2><label>Service date<input type="date" required value={serviceDate} onChange={(e) => setServiceDate(e.target.value)} /></label><p className="field-note">Online booking is available only on dates accepted by the clinic, up to {config.bookingWindow.maximumAdvanceBookingDays} days ahead.</p>
          <fieldset><legend>Services <span>Choose up to {config.serviceSelection.maximumSelections}</span></legend><div className="choice-list">{config.services.map((service) => <label className="choice-row" key={service.id}><input type="checkbox" checked={selectedServices.includes(service.id)} onChange={(e) => setSelectedServices((current) => e.target.checked ? current.length < config.serviceSelection.maximumSelections ? [...current, service.id] : current : current.filter((id) => id !== service.id))} /><span><strong>{service.name}</strong><small>{service.durationMinutes} min</small></span></label>)}</div></fieldset>
        </section>
        <section className="form-section"><h2>Patient details</h2><div className="field-grid"><label>First name<input required maxLength={100} value={firstName} onChange={(e) => setFirstName(e.target.value)} /></label><label>Middle name <span className="optional">Optional</span><input maxLength={100} value={middleName} onChange={(e) => setMiddleName(e.target.value)} /></label><label>Last name<input required maxLength={100} value={lastName} onChange={(e) => setLastName(e.target.value)} /></label><label>Suffix <span className="optional">Optional</span><input maxLength={20} value={suffix} onChange={(e) => setSuffix(e.target.value)} /></label></div><label>Have you been a patient at this clinic before?<select value={existingPatientResponse} onChange={(e) => setExistingPatientResponse(e.target.value as 'YES' | 'NO' | 'UNSURE')}><option value="YES">Yes</option><option value="NO">No</option><option value="UNSURE">Not sure</option></select></label><label>Mobile number<input type="tel" inputMode="tel" autoComplete="tel" required maxLength={30} placeholder="09… or +63…" value={mobileNumber} onChange={(e) => setMobileNumber(e.target.value)} /></label><p className="field-note">We use this number for booking verification and necessary appointment messages.</p></section>
        {config.bookingQuestions.length ? <section className="form-section"><h2>Clinic questions</h2>{config.bookingQuestions.map((question) => <label key={question.id}>{question.questionText}{question.isRequired ? '' : <span className="optional"> Optional</span>}{question.helpText ? <small className="help-text">{question.helpText}</small> : null}{question.type === 'TEXT' ? <textarea required={question.isRequired} maxLength={question.textMaximumLength ?? 10000} value={answers[question.id] ?? ''} onChange={(e) => setAnswers((current) => ({ ...current, [question.id]: e.target.value }))} /> : question.type === 'NUMBER' ? <input type="number" required={question.isRequired} min={question.numberMinimum ?? undefined} max={question.numberMaximum ?? undefined} value={answers[question.id] ?? ''} onChange={(e) => setAnswers((current) => ({ ...current, [question.id]: e.target.value }))} /> : question.type === 'BOOLEAN' ? <select required={question.isRequired} value={answers[question.id] ?? ''} onChange={(e) => setAnswers((current) => ({ ...current, [question.id]: e.target.value }))}><option value="">Choose</option><option value="true">Yes</option><option value="false">No</option></select> : <select required={question.isRequired} value={answers[question.id] ?? ''} onChange={(e) => setAnswers((current) => ({ ...current, [question.id]: e.target.value }))}><option value="">Choose</option>{selectValues(question.selectOptions).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>}</label>)}</section> : null}
        <section className="form-section"><h2>Privacy and communication</h2><label className="check-line"><input type="checkbox" checked={privacyAcknowledged} onChange={(e) => setPrivacyAcknowledged(e.target.checked)} /><span>I have read and acknowledge the Privacy Notice ({PRIVACY_NOTICE_VERSION}) and understand that necessary operational messages may be sent for this booking.</span></label><label className="check-line"><input type="checkbox" checked={scheduledReminderOptIn} onChange={(e) => setScheduledReminderOptIn(e.target.checked)} /><span>I may receive an optional future reminder from the clinic. This is optional and separate from messages needed for this appointment.</span></label></section>
        {error ? <div className="form-error" role="alert">{error}</div> : null}<div className="form-actions"><Link className="secondary-action" to={`/public/practice-locations/${encodeURIComponent(publicIdentifier)}`}>Back to clinic</Link><button className="primary" type="submit" disabled={busy}>{busy ? 'Checking…' : draft ? 'Save changes and verify again' : 'Continue to verification'}</button></div>
      </form>
    </> : null}

    {stage === 'otp' ? <section className="booking-narrow"><p className="eyebrow">Mobile verification</p><h1>Enter the 6-digit code</h1><p>We sent a booking verification code to the mobile number you provided. Codes expire after five minutes.</p><form className="stack" onSubmit={verifyOtp}><label>Verification code<input className="otp-input" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))} /></label>{error ? <div className="form-error" role="alert">{error}</div> : null}<button className="primary" type="submit" disabled={busy || otp.length !== 6}>{busy ? 'Verifying…' : 'Verify code'}</button><button className="secondary" type="button" disabled={busy} onClick={resendOtp}>Send a new code</button><button className="text-button" type="button" onClick={() => { setError(''); setStage('details'); }}>Change booking details</button></form></section> : null}

    {stage === 'review' && payload ? <section className="booking-narrow"><p className="eyebrow">Review</p><h1>Check your booking</h1><div className="review-list"><div><span>Clinic</span><strong>{config.practiceLocation.name}</strong></div><div><span>Date</span><strong>{payload.serviceDate}</strong></div><div><span>Patient</span><strong>{[payload.firstName, payload.middleName, payload.lastName, payload.suffix].filter(Boolean).join(' ')}</strong></div><div><span>Services</span><strong>{selectedServiceRows.map((service) => service.name).join(', ')}</strong></div><div><span>Mobile</span><strong>{payload.mobileNumber}</strong></div></div>{error ? <div className="form-error" role="alert">{error}</div> : null}<div className="form-actions stacked-actions"><button className="primary" type="button" disabled={busy} onClick={confirm}>{busy ? 'Confirming…' : 'Confirm appointment'}</button><button className="secondary" type="button" onClick={() => { setError(''); setStage('details'); }}>Edit booking</button></div><p className="field-note">Availability and clinic rules are checked again when you confirm. Your queue number is assigned only after successful confirmation.</p></section> : null}

    {stage === 'confirmed' && confirmation ? <section className="booking-narrow confirmed-panel"><p className="eyebrow">Confirmed</p><h1>Your appointment is booked.</h1><div className="queue-confirmation"><span>Queue number</span><strong>{confirmation.appointment.queueNumber}</strong></div><div className="review-list"><div><span>Booking reference</span><strong>{confirmation.appointment.bookingReference}</strong></div><div><span>Service date</span><strong>{String(confirmation.appointment.serviceDate).slice(0, 10)}</strong></div></div><Link className="primary-action full-action" to={`/patient-bookings/${encodeURIComponent(confirmation.appointment.bookingReference)}`}>View appointment</Link><p className="field-note">Keep this booking available on this device. Access is protected by a secure browser cookie rather than a token shown in the URL.</p></section> : null}
  </article></main>;
}
