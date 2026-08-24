import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ApiError, apiRequest } from '../api/client';

type DraftStatus = 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'RETURNED_FOR_REWORK';
type Weekday = 'MONDAY' | 'TUESDAY' | 'WEDNESDAY' | 'THURSDAY' | 'FRIDAY' | 'SATURDAY' | 'SUNDAY';
type ServiceStatus = 'ACTIVE' | 'INACTIVE';
type QuestionType = 'TEXT' | 'NUMBER' | 'YES_NO' | 'SELECT';

type Schedule = {
  weekday: Weekday;
  isOpen: boolean;
  opensAtLocal: string | null;
  closesAtLocal: string | null;
  maximumOnlineBookingUntilLocal: string | null;
  maximumOperatingUntilLocal: string | null;
};
type ProposedSchedule = {
  weekday: Weekday;
  proposedIsOpen: boolean;
  proposedOpensAtLocal: string | null;
  proposedClosesAtLocal: string | null;
  proposedMaximumOnlineBookingUntilLocal: string | null;
  proposedMaximumOperatingUntilLocal: string | null;
};
type EffectiveService = { id: string; name: string; durationMinutes: number; status: ServiceStatus };
type ProposedService = {
  id: string;
  practiceLocationServiceId: string | null;
  proposedName: string;
  proposedDurationMinutes: number;
  proposedStatus: ServiceStatus;
};
type EffectiveQuestion = {
  id: string;
  questionText: string;
  helpText: string | null;
  type: QuestionType;
  isRequired: boolean;
  displayOrder: number;
  isActive: boolean;
  textMaximumLength: number | null;
  numberMinimum: number | string | null;
  numberMaximum: number | string | null;
  selectOptions: unknown;
};
type ProposedQuestion = {
  id: string;
  bookingQuestionId: string | null;
  proposedQuestionText: string;
  proposedHelpText: string | null;
  proposedType: QuestionType;
  proposedIsRequired: boolean;
  proposedDisplayOrder: number;
  proposedIsActive: boolean;
  proposedTextMaximumLength: number | null;
  proposedNumberMinimum: number | string | null;
  proposedNumberMaximum: number | string | null;
  proposedSelectOptions: unknown;
};
type ProposedException = {
  id: string;
  serviceDate: string;
  proposedIsOpen: boolean;
  proposedOpensAtLocal: string | null;
  proposedClosesAtLocal: string | null;
  proposedMaximumOnlineBookingUntilLocal: string | null;
  proposedMaximumOperatingUntilLocal: string | null;
};
type DraftDetail = {
  id: string;
  status: DraftStatus;
  submittedAt: string | null;
  reviewedAt: string | null;
  reviewComment: string | null;
  practiceLocation: {
    id: string;
    name: string | null;
    lifecycleStatus: string;
    timeZone: string | null;
    practiceSchedules: Schedule[];
    services: EffectiveService[];
    bookingQuestions: EffectiveQuestion[];
  };
  proposedPracticeSchedules: ProposedSchedule[];
  proposedServices: ProposedService[];
  proposedBookingQuestions: ProposedQuestion[];
  proposedScheduleExceptions: ProposedException[];
};

type ScheduleForm = {
  weekday: Weekday;
  isOpen: boolean;
  opensAtLocal: string;
  closesAtLocal: string;
  maximumOnlineBookingUntilLocal: string;
  maximumOperatingUntilLocal: string;
};

type ServiceForm = { name: string; durationMinutes: string; status: ServiceStatus };
type QuestionForm = {
  questionText: string;
  helpText: string;
  type: QuestionType;
  isRequired: boolean;
  displayOrder: string;
  isActive: boolean;
};

const weekdays: Weekday[] = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'];

function timeOnly(value: string | null | undefined) {
  if (!value) return '';
  const match = /T(\d{2}):(\d{2})/.exec(value);
  return match ? `${match[1]}:${match[2]}` : value.slice(0, 5);
}
function dateOnly(value: string) {
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(value);
  return match?.[1] ?? value;
}
function dayLabel(day: Weekday) { return day.charAt(0) + day.slice(1).toLowerCase(); }
function statusLabel(status: DraftStatus) { return status === 'RETURNED_FOR_REWORK' ? 'Returned for rework' : status.charAt(0) + status.slice(1).toLowerCase(); }
function messageFrom(error: unknown) { return error instanceof ApiError ? error.message : 'Unable to complete this settings action. Please try again.'; }

function scheduleForms(detail: DraftDetail): ScheduleForm[] {
  const effective = new Map(detail.practiceLocation.practiceSchedules.map((row) => [row.weekday, row]));
  const proposals = new Map(detail.proposedPracticeSchedules.map((row) => [row.weekday, row]));
  return weekdays.map((weekday) => {
    const proposed = proposals.get(weekday);
    const current = effective.get(weekday);
    return {
      weekday,
      isOpen: proposed ? proposed.proposedIsOpen : current?.isOpen ?? false,
      opensAtLocal: timeOnly(proposed?.proposedOpensAtLocal ?? current?.opensAtLocal),
      closesAtLocal: timeOnly(proposed?.proposedClosesAtLocal ?? current?.closesAtLocal),
      maximumOnlineBookingUntilLocal: timeOnly(proposed?.proposedMaximumOnlineBookingUntilLocal ?? current?.maximumOnlineBookingUntilLocal),
      maximumOperatingUntilLocal: timeOnly(proposed?.proposedMaximumOperatingUntilLocal ?? current?.maximumOperatingUntilLocal),
    };
  });
}

function questionSelectOptions(value: unknown): Array<{ value: string; label: string }> | undefined {
  if (!Array.isArray(value)) return undefined;
  const rows = value.filter((item): item is { value: string; label: string } => Boolean(item && typeof item === 'object' && 'value' in item && 'label' in item));
  return rows.length ? rows : undefined;
}

export function SecretarySettingsDraftPage() {
  const { draftId } = useParams();
  const [detail, setDetail] = useState<DraftDetail | null>(null);
  const [schedules, setSchedules] = useState<ScheduleForm[]>([]);
  const [serviceForms, setServiceForms] = useState<Record<string, ServiceForm>>({});
  const [questionForms, setQuestionForms] = useState<Record<string, QuestionForm>>({});
  const [newService, setNewService] = useState<ServiceForm>({ name: '', durationMinutes: '15', status: 'ACTIVE' });
  const [newQuestion, setNewQuestion] = useState<QuestionForm>({ questionText: '', helpText: '', type: 'TEXT', isRequired: false, displayOrder: '0', isActive: true });
  const [exception, setException] = useState({ serviceDate: '', isOpen: false, opensAtLocal: '', closesAtLocal: '', maximumOnlineBookingUntilLocal: '', maximumOperatingUntilLocal: '' });
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const editable = detail?.status === 'DRAFT' || detail?.status === 'RETURNED_FOR_REWORK';

  async function load() {
    if (!draftId) return;
    setLoading(true);
    setError('');
    try {
      const response = await apiRequest<DraftDetail>(`/secretary-settings-drafts/${encodeURIComponent(draftId)}`);
      setDetail(response);
      setSchedules(scheduleForms(response));
      const services: Record<string, ServiceForm> = {};
      for (const current of response.practiceLocation.services) {
        const proposed = response.proposedServices.find((row) => row.practiceLocationServiceId === current.id);
        services[current.id] = {
          name: proposed?.proposedName ?? current.name,
          durationMinutes: String(proposed?.proposedDurationMinutes ?? current.durationMinutes),
          status: proposed?.proposedStatus ?? current.status,
        };
      }
      for (const proposed of response.proposedServices.filter((row) => !row.practiceLocationServiceId)) {
        services[`proposal:${proposed.id}`] = { name: proposed.proposedName, durationMinutes: String(proposed.proposedDurationMinutes), status: proposed.proposedStatus };
      }
      setServiceForms(services);

      const questions: Record<string, QuestionForm> = {};
      for (const current of response.practiceLocation.bookingQuestions) {
        const proposed = response.proposedBookingQuestions.find((row) => row.bookingQuestionId === current.id);
        questions[current.id] = {
          questionText: proposed?.proposedQuestionText ?? current.questionText,
          helpText: proposed?.proposedHelpText ?? current.helpText ?? '',
          type: proposed?.proposedType ?? current.type,
          isRequired: proposed?.proposedIsRequired ?? current.isRequired,
          displayOrder: String(proposed?.proposedDisplayOrder ?? current.displayOrder),
          isActive: proposed?.proposedIsActive ?? current.isActive,
        };
      }
      for (const proposed of response.proposedBookingQuestions.filter((row) => !row.bookingQuestionId)) {
        questions[`proposal:${proposed.id}`] = {
          questionText: proposed.proposedQuestionText,
          helpText: proposed.proposedHelpText ?? '',
          type: proposed.proposedType,
          isRequired: proposed.proposedIsRequired,
          displayOrder: String(proposed.proposedDisplayOrder),
          isActive: proposed.proposedIsActive,
        };
      }
      setQuestionForms(questions);
    } catch (caught) {
      setError(messageFrom(caught));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [draftId]);

  async function run(key: string, action: () => Promise<unknown>, success: string) {
    if (working) return;
    setWorking(key);
    setError('');
    setNotice('');
    try {
      await action();
      await load();
      setNotice(success);
    } catch (caught) {
      setError(messageFrom(caught));
    } finally {
      setWorking('');
    }
  }

  async function saveSchedule(row: ScheduleForm) {
    if (!draftId) return;
    await run(`schedule:${row.weekday}`, () => apiRequest(`/secretary-settings-drafts/${encodeURIComponent(draftId)}/practice-schedule`, {
      method: 'PUT',
      body: {
        weekday: row.weekday,
        isOpen: row.isOpen,
        opensAtLocal: row.isOpen ? row.opensAtLocal || undefined : undefined,
        closesAtLocal: row.isOpen ? row.closesAtLocal || undefined : undefined,
        maximumOnlineBookingUntilLocal: row.isOpen ? row.maximumOnlineBookingUntilLocal || undefined : undefined,
        maximumOperatingUntilLocal: row.isOpen ? row.maximumOperatingUntilLocal || undefined : undefined,
      },
    }), `${dayLabel(row.weekday)} proposal saved.`);
  }

  async function saveService(key: string) {
    if (!draftId) return;
    const form = serviceForms[key];
    if (!form) return;
    const isProposal = key.startsWith('proposal:');
    const proposalId = isProposal ? key.slice('proposal:'.length) : '';
    const path = isProposal
      ? `/secretary-settings-drafts/${encodeURIComponent(draftId)}/services/proposals/${encodeURIComponent(proposalId)}`
      : `/secretary-settings-drafts/${encodeURIComponent(draftId)}/services/effective/${encodeURIComponent(key)}`;
    await run(`service:${key}`, () => apiRequest(path, {
      method: 'PUT',
      body: { name: form.name, durationMinutes: Number(form.durationMinutes), status: form.status },
    }), 'Service proposal saved.');
  }

  async function createService(event: FormEvent) {
    event.preventDefault();
    if (!draftId) return;
    await run('new-service', () => apiRequest(`/secretary-settings-drafts/${encodeURIComponent(draftId)}/services`, {
      method: 'POST', body: { name: newService.name, durationMinutes: Number(newService.durationMinutes), status: newService.status },
    }), 'New service proposal added.');
    setNewService({ name: '', durationMinutes: '15', status: 'ACTIVE' });
  }

  function questionPayload(form: QuestionForm, source?: EffectiveQuestion | ProposedQuestion) {
    const type = form.type;
    const effectiveSource = source && 'questionText' in source ? source : undefined;
    const proposedSource = source && 'proposedQuestionText' in source ? source : undefined;
    return {
      questionText: form.questionText,
      helpText: form.helpText || undefined,
      type,
      isRequired: form.isRequired,
      displayOrder: Number(form.displayOrder),
      isActive: form.isActive,
      textMaximumLength: type === 'TEXT' ? (proposedSource?.proposedTextMaximumLength ?? effectiveSource?.textMaximumLength ?? 500) : undefined,
      numberMinimum: type === 'NUMBER' ? Number(proposedSource?.proposedNumberMinimum ?? effectiveSource?.numberMinimum ?? 0) : undefined,
      numberMaximum: type === 'NUMBER' ? Number(proposedSource?.proposedNumberMaximum ?? effectiveSource?.numberMaximum ?? 1000000) : undefined,
      selectOptions: type === 'SELECT' ? questionSelectOptions(proposedSource?.proposedSelectOptions ?? effectiveSource?.selectOptions) : undefined,
    };
  }

  async function saveQuestion(key: string) {
    if (!draftId || !detail) return;
    const form = questionForms[key];
    if (!form) return;
    const isProposal = key.startsWith('proposal:');
    const proposalId = isProposal ? key.slice('proposal:'.length) : '';
    const source = isProposal
      ? detail.proposedBookingQuestions.find((row) => row.id === proposalId)
      : detail.practiceLocation.bookingQuestions.find((row) => row.id === key);
    const path = isProposal
      ? `/secretary-settings-drafts/${encodeURIComponent(draftId)}/booking-questions/proposals/${encodeURIComponent(proposalId)}`
      : `/secretary-settings-drafts/${encodeURIComponent(draftId)}/booking-questions/effective/${encodeURIComponent(key)}`;
    await run(`question:${key}`, () => apiRequest(path, { method: 'PUT', body: questionPayload(form, source) }), 'Booking-question proposal saved.');
  }

  async function createQuestion(event: FormEvent) {
    event.preventDefault();
    if (!draftId) return;
    await run('new-question', () => apiRequest(`/secretary-settings-drafts/${encodeURIComponent(draftId)}/booking-questions`, {
      method: 'POST', body: questionPayload(newQuestion),
    }), 'New booking-question proposal added.');
    setNewQuestion({ questionText: '', helpText: '', type: 'TEXT', isRequired: false, displayOrder: '0', isActive: true });
  }

  async function saveException(event: FormEvent) {
    event.preventDefault();
    if (!draftId) return;
    await run('exception', () => apiRequest(`/secretary-settings-drafts/${encodeURIComponent(draftId)}/schedule-exception`, {
      method: 'PUT',
      body: {
        serviceDate: exception.serviceDate,
        isOpen: exception.isOpen,
        opensAtLocal: exception.isOpen ? exception.opensAtLocal || undefined : undefined,
        closesAtLocal: exception.isOpen ? exception.closesAtLocal || undefined : undefined,
        maximumOnlineBookingUntilLocal: exception.isOpen ? exception.maximumOnlineBookingUntilLocal || undefined : undefined,
        maximumOperatingUntilLocal: exception.isOpen ? exception.maximumOperatingUntilLocal || undefined : undefined,
      },
    }), 'Date-specific schedule proposal saved.');
  }

  async function submitDraft() {
    if (!draftId) return;
    await run('submit', () => apiRequest(`/secretary-settings-drafts/${encodeURIComponent(draftId)}/submit`, { method: 'POST' }), 'Draft submitted to the Doctor for review.');
  }

  const clinicName = detail?.practiceLocation.name?.trim() || 'Clinic settings';
  const proposalsCount = useMemo(() => detail ? detail.proposedPracticeSchedules.length + detail.proposedServices.length + detail.proposedBookingQuestions.length + detail.proposedScheduleExceptions.length : 0, [detail]);

  if (loading) return <section className="practice-admin-page"><p className="practice-muted">Loading settings draft…</p></section>;
  if (!detail) return <section className="practice-admin-page"><div className="form-error" role="alert">{error || 'Settings draft was not found.'}</div><Link to="/app/secretary/clinics">Assigned clinics</Link></section>;

  return (
    <section className="practice-admin-page" aria-labelledby="secretary-draft-heading">
      <div className="practice-admin-heading">
        <div><p className="eyebrow">Secretary settings proposal</p><h1 id="secretary-draft-heading">{clinicName}</h1><p>Changes on this page are proposals only. Effective clinic settings change only after Doctor approval.</p></div>
        <Link className="secondary-action" to="/app/secretary/clinics">← Assigned clinics</Link>
      </div>

      <div className="practice-location-title-row"><span className="practice-status">{statusLabel(detail.status)}</span><span className="practice-muted">{proposalsCount} saved proposal{proposalsCount === 1 ? '' : 's'}</span></div>
      {detail.reviewComment ? <div className="practice-notice"><strong>Doctor note:</strong> {detail.reviewComment}</div> : null}
      {detail.status === 'SUBMITTED' ? <div className="practice-notice">This draft is waiting for Doctor review. It cannot be edited or withdrawn by the Secretary.</div> : null}
      {detail.status === 'APPROVED' ? <div className="practice-notice practice-success">This draft was approved and is closed.</div> : null}
      {detail.status === 'REJECTED' ? <div className="practice-notice">This draft was rejected and is permanently closed.</div> : null}
      {detail.status === 'RETURNED_FOR_REWORK' ? <div className="practice-notice">The Doctor returned this same draft for rework. Revise it and submit again when ready.</div> : null}
      {error ? <div className="form-error" role="alert">{error}</div> : null}
      {notice ? <div className="practice-notice practice-success" role="status">{notice}</div> : null}

      <section className="practice-create-panel">
        <div className="practice-panel-heading"><div><p className="eyebrow">Recurring hours</p><h2>Weekly clinic schedule</h2><p>Save only the days you want to propose changing. Draft conflicts may be saved; final approval performs current-state conflict validation.</p></div></div>
        <div className="stack">
          {schedules.map((row) => (
            <div className="practice-location-card" key={row.weekday}>
              <div className="stack">
                <label><input type="checkbox" disabled={!editable} checked={row.isOpen} onChange={(event) => setSchedules((current) => current.map((item) => item.weekday === row.weekday ? { ...item, isOpen: event.target.checked } : item))} /> {dayLabel(row.weekday)} open</label>
                {row.isOpen ? <div className="practice-form-grid"><label>Opens<input type="time" disabled={!editable} value={row.opensAtLocal} onChange={(event) => setSchedules((current) => current.map((item) => item.weekday === row.weekday ? { ...item, opensAtLocal: event.target.value } : item))} /></label><label>Closes<input type="time" disabled={!editable} value={row.closesAtLocal} onChange={(event) => setSchedules((current) => current.map((item) => item.weekday === row.weekday ? { ...item, closesAtLocal: event.target.value } : item))} /></label><label>Online cutoff <span className="optional">Optional</span><input type="time" disabled={!editable} value={row.maximumOnlineBookingUntilLocal} onChange={(event) => setSchedules((current) => current.map((item) => item.weekday === row.weekday ? { ...item, maximumOnlineBookingUntilLocal: event.target.value } : item))} /></label><label>Maximum operating until <span className="optional">Optional</span><input type="time" disabled={!editable} value={row.maximumOperatingUntilLocal} onChange={(event) => setSchedules((current) => current.map((item) => item.weekday === row.weekday ? { ...item, maximumOperatingUntilLocal: event.target.value } : item))} /></label></div> : null}
              </div>
              {editable ? <button className="secondary" type="button" disabled={Boolean(working)} onClick={() => void saveSchedule(row)}>{working === `schedule:${row.weekday}` ? 'Saving…' : 'Save day proposal'}</button> : null}
            </div>
          ))}
        </div>
      </section>

      <section className="practice-create-panel">
        <div className="practice-panel-heading"><div><p className="eyebrow">Services</p><h2>Clinic services</h2><p>Edit an existing service proposal, mark a service inactive for future booking, or propose a new clinic service.</p></div></div>
        <div className="practice-list">
          {Object.entries(serviceForms).map(([key, form]) => <div className="practice-location-card" key={key}><div className="practice-form-grid"><label>Name<input disabled={!editable} value={form.name} onChange={(e) => setServiceForms((current) => ({ ...current, [key]: { ...form, name: e.target.value } }))} /></label><label>Duration minutes<input type="number" min="1" disabled={!editable} value={form.durationMinutes} onChange={(e) => setServiceForms((current) => ({ ...current, [key]: { ...form, durationMinutes: e.target.value } }))} /></label><label>Status<select disabled={!editable} value={form.status} onChange={(e) => setServiceForms((current) => ({ ...current, [key]: { ...form, status: e.target.value as ServiceStatus } }))}><option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option></select></label></div>{editable ? <button className="secondary" disabled={Boolean(working)} onClick={() => void saveService(key)}>{working === `service:${key}` ? 'Saving…' : 'Save service proposal'}</button> : null}</div>)}
        </div>
        {editable ? <form className="practice-form" onSubmit={createService}><h3>Propose new service</h3><div className="practice-form-grid"><label>Name<input required value={newService.name} onChange={(e) => setNewService({ ...newService, name: e.target.value })} /></label><label>Duration minutes<input required type="number" min="1" value={newService.durationMinutes} onChange={(e) => setNewService({ ...newService, durationMinutes: e.target.value })} /></label></div><button className="secondary" disabled={Boolean(working)}>{working === 'new-service' ? 'Adding…' : 'Add service proposal'}</button></form> : null}
      </section>

      <section className="practice-create-panel">
        <div className="practice-panel-heading"><div><p className="eyebrow">Booking questions</p><h2>Patient booking questions</h2><p>Question edits remain proposed until Doctor approval. Historical type protections are still enforced by the backend.</p></div></div>
        <div className="practice-list">
          {Object.entries(questionForms).map(([key, form]) => <div className="practice-location-card" key={key}><div className="stack"><label>Question<input disabled={!editable} value={form.questionText} onChange={(e) => setQuestionForms((current) => ({ ...current, [key]: { ...form, questionText: e.target.value } }))} /></label><label>Help text <span className="optional">Optional</span><input disabled={!editable} value={form.helpText} onChange={(e) => setQuestionForms((current) => ({ ...current, [key]: { ...form, helpText: e.target.value } }))} /></label><div className="practice-form-grid"><label>Type<select disabled={!editable} value={form.type} onChange={(e) => setQuestionForms((current) => ({ ...current, [key]: { ...form, type: e.target.value as QuestionType } }))}><option value="TEXT">Text</option><option value="NUMBER">Number</option><option value="YES_NO">Yes / No</option><option value="SELECT">Select</option></select></label><label>Display order<input type="number" min="0" disabled={!editable} value={form.displayOrder} onChange={(e) => setQuestionForms((current) => ({ ...current, [key]: { ...form, displayOrder: e.target.value } }))} /></label></div><label><input type="checkbox" disabled={!editable} checked={form.isRequired} onChange={(e) => setQuestionForms((current) => ({ ...current, [key]: { ...form, isRequired: e.target.checked } }))} /> Required</label><label><input type="checkbox" disabled={!editable} checked={form.isActive} onChange={(e) => setQuestionForms((current) => ({ ...current, [key]: { ...form, isActive: e.target.checked } }))} /> Active for new bookings</label></div>{editable ? <button className="secondary" disabled={Boolean(working)} onClick={() => void saveQuestion(key)}>{working === `question:${key}` ? 'Saving…' : 'Save question proposal'}</button> : null}</div>)}
        </div>
        {editable ? <form className="practice-form" onSubmit={createQuestion}><h3>Propose new booking question</h3><label>Question<input required value={newQuestion.questionText} onChange={(e) => setNewQuestion({ ...newQuestion, questionText: e.target.value })} /></label><div className="practice-form-grid"><label>Type<select value={newQuestion.type} onChange={(e) => setNewQuestion({ ...newQuestion, type: e.target.value as QuestionType })}><option value="TEXT">Text</option><option value="NUMBER">Number</option><option value="YES_NO">Yes / No</option></select></label><label>Display order<input type="number" min="0" value={newQuestion.displayOrder} onChange={(e) => setNewQuestion({ ...newQuestion, displayOrder: e.target.value })} /></label></div><button className="secondary" disabled={Boolean(working)}>{working === 'new-question' ? 'Adding…' : 'Add question proposal'}</button></form> : null}
      </section>

      <section className="practice-create-panel">
        <div className="practice-panel-heading"><div><p className="eyebrow">Date exception</p><h2>One-date schedule proposal</h2><p>A date-specific exception replaces the recurring schedule for that clinic date.</p></div></div>
        {detail.proposedScheduleExceptions.length ? <div className="practice-location-meta">{detail.proposedScheduleExceptions.map((row) => <span key={row.id}>{dateOnly(row.serviceDate)} · {row.proposedIsOpen ? `${timeOnly(row.proposedOpensAtLocal)}–${timeOnly(row.proposedClosesAtLocal)}` : 'Closed'}</span>)}</div> : <p className="practice-muted">No date-specific proposals yet.</p>}
        {editable ? <form className="practice-form" onSubmit={saveException}><div className="practice-form-grid"><label>Date<input required type="date" value={exception.serviceDate} onChange={(e) => setException({ ...exception, serviceDate: e.target.value })} /></label><label><input type="checkbox" checked={exception.isOpen} onChange={(e) => setException({ ...exception, isOpen: e.target.checked })} /> Clinic open on this date</label></div>{exception.isOpen ? <div className="practice-form-grid"><label>Opens<input required type="time" value={exception.opensAtLocal} onChange={(e) => setException({ ...exception, opensAtLocal: e.target.value })} /></label><label>Closes<input required type="time" value={exception.closesAtLocal} onChange={(e) => setException({ ...exception, closesAtLocal: e.target.value })} /></label><label>Online cutoff <span className="optional">Optional</span><input type="time" value={exception.maximumOnlineBookingUntilLocal} onChange={(e) => setException({ ...exception, maximumOnlineBookingUntilLocal: e.target.value })} /></label><label>Maximum operating until <span className="optional">Optional</span><input type="time" value={exception.maximumOperatingUntilLocal} onChange={(e) => setException({ ...exception, maximumOperatingUntilLocal: e.target.value })} /></label></div> : null}<button className="secondary" disabled={Boolean(working)}>{working === 'exception' ? 'Saving…' : 'Save date proposal'}</button></form> : null}
      </section>

      {editable ? <section className="practice-create-panel"><div className="practice-panel-heading"><div><p className="eyebrow">Submit for approval</p><h2>Send this draft to the Doctor</h2><p>After submission you cannot edit or withdraw this draft. The Doctor may approve it, reject it, or return the same draft for rework.</p></div></div><button className="primary" type="button" disabled={Boolean(working)} onClick={() => void submitDraft()}>{working === 'submit' ? 'Submitting…' : 'Submit draft to Doctor'}</button></section> : null}
    </section>
  );
}
