import { FormEvent, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ApiError, apiRequest } from '../api/client';

type Service = { id: string; name: string; durationMinutes: number; status: 'ACTIVE' | 'INACTIVE' };
type QuestionType = 'TEXT' | 'NUMBER' | 'BOOLEAN' | 'SINGLE_SELECT';
type SelectOption = { value: string; label: string };
type Question = {
  id: string;
  questionText: string;
  helpText: string | null;
  type: QuestionType;
  isRequired: boolean;
  displayOrder: number;
  isActive: boolean;
  textMaximumLength: number | null;
  numberMinimum: string | number | null;
  numberMaximum: string | number | null;
  selectOptions: SelectOption[] | null;
};
type ConfigurationItems = { services: Service[]; bookingQuestions: Question[] };

type QuestionDraft = {
  questionText: string;
  helpText: string;
  type: QuestionType;
  isRequired: boolean;
  displayOrder: number;
  isActive: boolean;
  textMaximumLength: string;
  numberMinimum: string;
  numberMaximum: string;
  selectOptionsText: string;
};

const emptyQuestion: QuestionDraft = { questionText: '', helpText: '', type: 'TEXT', isRequired: false, displayOrder: 0, isActive: true, textMaximumLength: '', numberMinimum: '', numberMaximum: '', selectOptionsText: '' };

function messageFrom(error: unknown) { return error instanceof ApiError ? error.message : 'Unable to update clinic configuration. Please try again.'; }
function questionDraft(question?: Question): QuestionDraft {
  if (!question) return { ...emptyQuestion };
  return {
    questionText: question.questionText,
    helpText: question.helpText ?? '',
    type: question.type,
    isRequired: question.isRequired,
    displayOrder: question.displayOrder,
    isActive: question.isActive,
    textMaximumLength: question.textMaximumLength?.toString() ?? '',
    numberMinimum: question.numberMinimum?.toString() ?? '',
    numberMaximum: question.numberMaximum?.toString() ?? '',
    selectOptionsText: question.selectOptions?.map((option) => `${option.value}|${option.label}`).join('\n') ?? '',
  };
}
function questionPayload(draft: QuestionDraft) {
  const base = {
    questionText: draft.questionText,
    helpText: draft.helpText || undefined,
    type: draft.type,
    isRequired: draft.isRequired,
    displayOrder: Number(draft.displayOrder),
    isActive: draft.isActive,
  };
  if (draft.type === 'TEXT') return { ...base, textMaximumLength: draft.textMaximumLength ? Number(draft.textMaximumLength) : undefined };
  if (draft.type === 'NUMBER') return { ...base, numberMinimum: draft.numberMinimum ? Number(draft.numberMinimum) : undefined, numberMaximum: draft.numberMaximum ? Number(draft.numberMaximum) : undefined };
  if (draft.type === 'SINGLE_SELECT') return {
    ...base,
    selectOptions: draft.selectOptionsText.split('\n').map((line) => line.trim()).filter(Boolean).map((line) => {
      const [value, ...labelParts] = line.split('|');
      return { value: value?.trim() ?? '', label: labelParts.join('|').trim() };
    }),
  };
  return base;
}

export function ClinicServicesQuestionsPage() {
  const { practiceLocationId } = useParams();
  const [data, setData] = useState<ConfigurationItems>({ services: [], bookingQuestions: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [serviceName, setServiceName] = useState('');
  const [serviceDuration, setServiceDuration] = useState(15);
  const [question, setQuestion] = useState<QuestionDraft>({ ...emptyQuestion });
  const [editingService, setEditingService] = useState<Service | null>(null);
  const [editingQuestionId, setEditingQuestionId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    if (!practiceLocationId) return;
    setLoading(true); setError('');
    try { setData(await apiRequest<ConfigurationItems>(`/doctor/practice-locations/${encodeURIComponent(practiceLocationId)}/configuration-items`)); }
    catch (caught) { setError(messageFrom(caught)); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, [practiceLocationId]);

  async function saveNewService(event: FormEvent) {
    event.preventDefault(); if (!practiceLocationId || busy) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await apiRequest(`/doctor/practice-locations/${encodeURIComponent(practiceLocationId)}/services`, { method: 'POST', body: { name: serviceName, durationMinutes: Number(serviceDuration), status: 'ACTIVE' } });
      setServiceName(''); setServiceDuration(15); setNotice('Clinic service added.'); await load();
    } catch (caught) { setError(messageFrom(caught)); } finally { setBusy(false); }
  }

  async function saveService(service: Service) {
    if (!practiceLocationId || busy) return; setBusy(true); setError(''); setNotice('');
    try {
      await apiRequest(`/doctor/practice-locations/${encodeURIComponent(practiceLocationId)}/services/${encodeURIComponent(service.id)}`, { method: 'PATCH', body: { name: service.name, durationMinutes: Number(service.durationMinutes), status: service.status } });
      setEditingService(null); setNotice('Clinic service updated.'); await load();
    } catch (caught) { setError(messageFrom(caught)); } finally { setBusy(false); }
  }

  async function saveQuestion(event: FormEvent) {
    event.preventDefault(); if (!practiceLocationId || busy) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const suffix = editingQuestionId ? `/${encodeURIComponent(editingQuestionId)}` : '';
      await apiRequest(`/doctor/practice-locations/${encodeURIComponent(practiceLocationId)}/booking-questions${suffix}`, { method: editingQuestionId ? 'PATCH' : 'POST', body: questionPayload(question) });
      setQuestion({ ...emptyQuestion }); setEditingQuestionId(null); setNotice(editingQuestionId ? 'Booking question updated.' : 'Booking question added.'); await load();
    } catch (caught) { setError(messageFrom(caught)); } finally { setBusy(false); }
  }

  if (loading) return <section className="practice-admin-page"><p className="practice-muted">Loading clinic services and questions…</p></section>;

  return (
    <section className="practice-admin-page" aria-labelledby="clinic-items-heading">
      <div className="practice-admin-heading"><div><p className="eyebrow">Clinic configuration</p><h1 id="clinic-items-heading">Services & booking questions</h1><p>These are the effective settings for this clinic. Doctor changes apply directly; Secretary changes continue through the proposal-and-approval workflow.</p></div><Link className="secondary-action" to={`/app/practice-locations/${encodeURIComponent(practiceLocationId ?? '')}`}>← Clinic configuration</Link></div>
      {error ? <div className="form-error" role="alert">{error}</div> : null}
      {notice ? <div className="practice-notice practice-success" role="status">{notice}</div> : null}

      <section className="practice-create-panel"><div className="practice-panel-heading"><p className="eyebrow">Services</p><h2>Clinic services</h2><p>Inactive services remain in configuration history but are unavailable for new bookings.</p></div>
        {data.services.length === 0 ? <p className="practice-muted">No clinic services configured yet.</p> : data.services.map((service) => {
          const editing = editingService?.id === service.id;
          const current = editing ? editingService : service;
          return <article className="practice-location-card" key={service.id}><div>{editing ? <div className="practice-form-grid"><label>Name<input value={current!.name} maxLength={150} onChange={(e) => setEditingService({ ...current!, name: e.target.value })} /></label><label>Duration minutes<input type="number" min={1} max={1440} value={current!.durationMinutes} onChange={(e) => setEditingService({ ...current!, durationMinutes: Number(e.target.value) })} /></label><label>Status<select value={current!.status} onChange={(e) => setEditingService({ ...current!, status: e.target.value as Service['status'] })}><option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option></select></label></div> : <><h3>{service.name}</h3><p>{service.durationMinutes} minutes · {service.status}</p></>}</div><div className="practice-card-actions">{editing ? <><button className="primary" type="button" disabled={busy} onClick={() => void saveService(current!)}>Save</button><button className="secondary" type="button" onClick={() => setEditingService(null)}>Cancel</button></> : <button className="secondary" type="button" onClick={() => setEditingService({ ...service })}>Edit</button>}</div></article>;
        })}
        <form className="practice-form" onSubmit={saveNewService}><h3>Add clinic service</h3><div className="practice-form-grid"><label>Name<input required maxLength={150} value={serviceName} onChange={(e) => setServiceName(e.target.value)} /></label><label>Duration minutes<input required type="number" min={1} max={1440} value={serviceDuration} onChange={(e) => setServiceDuration(Number(e.target.value))} /></label></div><button className="primary" type="submit" disabled={busy || !serviceName.trim()}>Add service</button></form>
      </section>

      <section className="practice-create-panel"><div className="practice-panel-heading"><p className="eyebrow">Booking questions</p><h2>Patient booking questions</h2><p>At most five questions may be active. Questions with answer history cannot be materially redefined; create a replacement question and deactivate the old one.</p></div>
        {data.bookingQuestions.length === 0 ? <p className="practice-muted">No booking questions configured yet.</p> : data.bookingQuestions.map((item) => <article className="practice-location-card" key={item.id}><div><h3>{item.questionText}</h3><p>{item.type} · order {item.displayOrder} · {item.isRequired ? 'Required' : 'Optional'} · {item.isActive ? 'Active' : 'Inactive'}</p></div><div className="practice-card-actions"><button className="secondary" type="button" onClick={() => { setEditingQuestionId(item.id); setQuestion(questionDraft(item)); }}>Edit</button></div></article>)}
        <form className="practice-form" onSubmit={saveQuestion}><h3>{editingQuestionId ? 'Edit booking question' : 'Add booking question'}</h3><label>Question<input required maxLength={500} value={question.questionText} onChange={(e) => setQuestion((q) => ({ ...q, questionText: e.target.value }))} /></label><label>Help text<input maxLength={500} value={question.helpText} onChange={(e) => setQuestion((q) => ({ ...q, helpText: e.target.value }))} /></label><div className="practice-form-grid"><label>Type<select value={question.type} onChange={(e) => setQuestion((q) => ({ ...q, type: e.target.value as QuestionType }))}><option value="TEXT">Text</option><option value="NUMBER">Number</option><option value="BOOLEAN">Yes / No</option><option value="SINGLE_SELECT">Single select</option></select></label><label>Display order<input type="number" min={0} value={question.displayOrder} onChange={(e) => setQuestion((q) => ({ ...q, displayOrder: Number(e.target.value) }))} /></label></div><div className="button-row"><label><input type="checkbox" checked={question.isRequired} onChange={(e) => setQuestion((q) => ({ ...q, isRequired: e.target.checked }))} /> Required</label><label><input type="checkbox" checked={question.isActive} onChange={(e) => setQuestion((q) => ({ ...q, isActive: e.target.checked }))} /> Active</label></div>
          {question.type === 'TEXT' ? <label>Maximum text length <span className="optional">Optional</span><input type="number" min={1} value={question.textMaximumLength} onChange={(e) => setQuestion((q) => ({ ...q, textMaximumLength: e.target.value }))} /></label> : null}
          {question.type === 'NUMBER' ? <div className="practice-form-grid"><label>Minimum <span className="optional">Optional</span><input type="number" value={question.numberMinimum} onChange={(e) => setQuestion((q) => ({ ...q, numberMinimum: e.target.value }))} /></label><label>Maximum <span className="optional">Optional</span><input type="number" value={question.numberMaximum} onChange={(e) => setQuestion((q) => ({ ...q, numberMaximum: e.target.value }))} /></label></div> : null}
          {question.type === 'SINGLE_SELECT' ? <label>Options <span className="optional">One per line as value|label</span><textarea required value={question.selectOptionsText} onChange={(e) => setQuestion((q) => ({ ...q, selectOptionsText: e.target.value }))} placeholder={'new|New patient\nreturning|Returning patient'} /></label> : null}
          <div className="button-row"><button className="primary" type="submit" disabled={busy || !question.questionText.trim()}>{editingQuestionId ? 'Save question' : 'Add question'}</button>{editingQuestionId ? <button className="secondary" type="button" onClick={() => { setEditingQuestionId(null); setQuestion({ ...emptyQuestion }); }}>Cancel</button> : null}</div>
        </form>
      </section>
    </section>
  );
}
