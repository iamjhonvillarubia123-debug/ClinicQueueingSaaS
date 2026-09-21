import { useEffect, useRef, useState } from 'react';
import './ServiceManagementEditor.css';
import './QuestionManagementEditor.css';
import { apiRequest } from '../api/client';

type QuestionType = 'TEXT' | 'NUMBER' | 'BOOLEAN' | 'SINGLE_SELECT';

export type QuestionOption = {
  value: string;
  label: string;
};

type QuestionRow = {
  id: string | number;
  effectiveBookingQuestionId?: string;
  sourceDoctorBookingQuestionTemplateId?: string;
  order: number;
  question: string;
  type: QuestionType;
  required: boolean;
  active: boolean;
  options?: QuestionOption[];
};

type Props = {
  questions: QuestionRow[];
  setQuestions: (value: QuestionRow[]) => void;
};

const iconProps = {
  width: 18,
  height: 18,
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

function PencilIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" {...iconProps}>
      <path d="M4 20h4l11-11-4-4L4 16v4Z" />
      <path d="m13.5 6.5 4 4" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" {...iconProps}>
      <path d="M4 7h16" />
      <path d="m9 7 1-3h4l1 3" />
      <path d="m7 7 1 13h8l1-13" />
      <path d="M10 11v5M14 11v5" />
    </svg>
  );
}

function DocumentIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24" {...iconProps}><path d="M5 2h9l5 5v15H5ZM14 2v6h5M8 12h8M8 16h8" /></svg>;
}
const typeLabels: Record<QuestionType, string> = { TEXT: 'Text', NUMBER: 'Number', BOOLEAN: 'Yes / No', SINGLE_SELECT: 'Single Choice' };
const blankOption = (): QuestionOption => ({ value: `OPTION_${crypto.randomUUID()}`, label: '' });
function validate(question: QuestionRow) {
  if (!question.question.trim()) return 'Enter a question.';
  if (question.type === 'SINGLE_SELECT' && (question.options ?? []).filter((option) => option.label.trim()).length < 2) return 'Single Choice questions require at least 2 options.';
  return '';
}

export function QuestionManagementEditor({ questions, setQuestions }: Props) {
  const [draft, setDraft] = useState<QuestionRow | null>(null);
  const [adding, setAdding] = useState(false);
  const [defaultsOpen, setDefaultsOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [draggingId, setDraggingId] = useState<string | number | null>(null);
  const [draggingOption, setDraggingOption] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const activeCount = questions.filter((row) => row.active).length;
  const open = draft !== null || defaultsOpen;
  useEffect(() => {
    if (open) {
      opener.current = document.activeElement as HTMLElement;
      dialogRef.current?.showModal();
    } else {
      dialogRef.current?.close();
      opener.current?.focus();
    }
  }, [open]);
  function setRows(rows: QuestionRow[]) { setQuestions(rows.map((row, order) => ({ ...row, order }))); }
  function close() {
    if (busy) return;
    setDraft(null); setDefaultsOpen(false); setError(''); setDraggingOption(null);
  }
  function save(event: React.FormEvent) {
    event.preventDefault();
    if (!draft) return;
    const issue = validate(draft);
    if (issue) { setError(issue); return; }
    if (draft.active && questions.filter((row) => row.id !== draft.id && row.active).length >= 5) {
      setError('Maximum 5 active questions. Make another question inactive first.'); return;
    }
    const saved = { ...draft, question: draft.question.trim(), options: draft.type === 'SINGLE_SELECT' ? (draft.options ?? []).filter((option) => option.label.trim()).map((option) => ({ ...option, label: option.label.trim() })) : [] };
    setRows(adding ? [...questions, saved] : questions.map((row) => row.id === draft.id ? saved : row)); close();
  }
  async function applyDefaults() {
    setBusy(true); setError('');
    try {
      const data = await apiRequest<{ bookingQuestions: { id: string; questionText: string; type: QuestionType; isRequired: boolean; isActive: boolean; displayOrder: number; selectOptions?: QuestionOption[] | null }[] }>('/doctor/defaults');
      const rows = [...data.bookingQuestions].sort((a, b) => a.displayOrder - b.displayOrder).map((row, order): QuestionRow => ({
        id: `new-question-${crypto.randomUUID()}`, sourceDoctorBookingQuestionTemplateId: row.id,
        order, question: row.questionText, type: row.type, required: row.isRequired, active: row.isActive,
        options: row.type === 'SINGLE_SELECT' ? (row.selectOptions ?? []).map((option) => ({ ...option })) : [],
      }));
      if (!rows.length) { setError('No default questions are available. Add questions in your doctor profile first.'); return; }
      if (rows.filter((row) => row.active).length > 5) { setError('Your doctor defaults contain more than 5 active questions. Update the defaults before applying.'); return; }
      const invalid = rows.map(validate).find(Boolean);
      if (invalid) { setError(`Update your doctor defaults before applying: ${invalid}`); return; }
      setRows(rows); setDefaultsOpen(false);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to load doctor defaults. Please try again.'); }
    finally { setBusy(false); }
  }
  function moveOption(from: number, to: number) {
    if (!draft || to < 0 || to >= (draft.options ?? []).length) return;
    const options = [...(draft.options ?? [])];
    const [moved] = options.splice(from, 1); options.splice(to, 0, moved); setDraft({ ...draft, options });
  }

  return <>
    <section className="service-management-card" aria-label="Clinic questions">
      <div className="clinic-section-toolbar service-management-toolbar">
        <h3>Questions ({questions.length})</h3>
        <div>
          <button className="clinic-primary" type="button" onClick={() => { setError(''); setDefaultsOpen(true); }}><DocumentIcon />Apply Doctor Defaults</button>
          <button className="clinic-primary" type="button" onClick={() => {
            setAdding(true); setError(''); setDraft({ id: `new-question-${crypto.randomUUID()}`, order: questions.length, question: '', type: 'TEXT', required: false, active: activeCount < 5, options: [] });
          }}>+ Add Question</button>
        </div>
      </div>
      <div className="service-management-table question-management-table">
        <div className="service-management-head question-management-head" aria-hidden="true"><span>Question</span><span>Type</span><span>Status</span><span>Required</span><span>Actions</span></div>
        {questions.map((row) => <div className="service-management-row question-management-row" key={row.id} draggable title="Drag to reorder question"
          onDragStart={() => setDraggingId(row.id)} onDragOver={(event) => event.preventDefault()} onDragEnd={() => setDraggingId(null)}
          onDrop={(event) => {
            event.preventDefault();
            const from = questions.findIndex((item) => item.id === draggingId);
            if (from < 0 || draggingId === row.id) return;
            const rows = [...questions]; const [moved] = rows.splice(from, 1);
            rows.splice(questions.findIndex((item) => item.id === row.id), 0, moved); setRows(rows); setDraggingId(null);
          }}>
          <div className="service-management-service"><strong>{row.question}</strong>{row.type === 'SINGLE_SELECT' && <span>{row.options?.length ?? 0} options</span>}</div>
          <span className="question-management-type">{typeLabels[row.type]}</span>
          <div className="service-management-status"><span className={`clinic-status-pill ${row.active ? 'is-active' : 'is-inactive'}`}>{row.active ? 'Active' : 'Inactive'}</span></div>
          <div className="question-management-required"><input title={row.required ? 'Make this question optional' : 'Make this question required'} aria-label={`Required for ${row.question}`} type="checkbox" checked={row.required} onChange={(event) => setRows(questions.map((item) => item.id === row.id ? { ...item, required: event.target.checked } : item))} /></div>
          <div className="service-management-actions question-management-actions">
            <button className="service-management-icon-action" type="button" title="Edit question" aria-label={`Edit question ${row.question}`} onClick={() => { setAdding(false); setError(''); setDraft({ ...row, options: row.options?.map((option) => ({ ...option })) ?? [] }); }}><PencilIcon /></button>
            <button className="service-management-icon-action" type="button" title="Delete question" aria-label={`Delete question ${row.question}`} onClick={() => setRows(questions.filter((item) => item.id !== row.id))}><TrashIcon /></button>
          </div>
        </div>)}
        {!questions.length && <p className="service-management-empty">No questions added yet. Add a question or apply your doctor defaults.</p>}
      </div>
      <div className="service-management-note"><span aria-hidden="true">i</span><p>Maximum 5 active questions. Supported question types: Text, Number, Yes / No, and Single Choice.</p></div>
    </section>
    <dialog ref={dialogRef} className="service-management-dialog question-management-dialog" aria-labelledby="question-dialog-title" onCancel={(event) => { event.preventDefault(); close(); }}>
      <div className="service-dialog-heading"><h2 id="question-dialog-title">{defaultsOpen ? <><DocumentIcon />Apply Doctor Defaults</> : adding ? 'Add Question' : 'Edit Question'}</h2><button type="button" aria-label="Close question dialog" disabled={busy} onClick={close}>×</button></div>
      {defaultsOpen ? <>
        <p>This will copy your default booking questions from your doctor profile to this clinic.</p>
        <div className="service-management-note service-defaults-note"><span aria-hidden="true">i</span><ul><li>Existing questions in this clinic will be replaced.</li><li>Question text, types, choices, required settings and status will be copied.</li><li>You can review and edit the questions after applying.</li><li>A maximum of 5 questions can be active.</li></ul></div>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="service-dialog-footer"><button className="clinic-secondary" type="button" disabled={busy} onClick={close}>Cancel</button><button className="clinic-primary" type="button" disabled={busy} onClick={() => void applyDefaults()}>{busy ? 'Applying…' : 'Apply Defaults'}</button></div>
      </> : draft && <form onSubmit={save}>
        <div className="service-dialog-fields">
          <label className="question-dialog-text">Question <em>*</em><textarea autoFocus required maxLength={500} aria-label={`Question text for ${draft.question}`} placeholder="e.g. What is the reason for your visit?" value={draft.question} onChange={(event) => setDraft({ ...draft, question: event.target.value })} /></label>
          <label>Type <em>*</em><select aria-label={`Question type for ${draft.question}`} value={draft.type} onChange={(event) => {
            const type = event.target.value as QuestionType;
            setDraft({ ...draft, type, options: type === 'SINGLE_SELECT' ? draft.options?.length ? draft.options : [blankOption(), blankOption()] : [] }); setError('');
          }}>{Object.entries(typeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label>Status <em>*</em><select aria-label={`Status for ${draft.question}`} value={draft.active ? 'ACTIVE' : 'INACTIVE'} onChange={(event) => setDraft({ ...draft, active: event.target.value === 'ACTIVE' })}><option value="ACTIVE" disabled={questions.filter((row) => row.id !== draft.id && row.active).length >= 5}>Active</option><option value="INACTIVE">Inactive</option></select><small>Maximum 5 active questions.</small></label>
          <label className="question-dialog-required"><input type="checkbox" aria-label={`Required for ${draft.question}`} checked={draft.required} onChange={(event) => setDraft({ ...draft, required: event.target.checked })} />Required question</label>
        </div>
        {draft.type === 'SINGLE_SELECT' && <div className="question-dialog-options"><h3>Options patients can choose</h3><p>Patients can select one option only. Minimum 2 options are required.</p>
          {(draft.options ?? []).map((option, index) => <div className="question-dialog-option" key={option.value} draggable onDragStart={() => setDraggingOption(option.value)} onDragEnd={() => setDraggingOption(null)} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); const from = (draft.options ?? []).findIndex((item) => item.value === draggingOption); if (from >= 0) moveOption(from, index); setDraggingOption(null); }}>
            <input aria-label={`Option ${index + 1} for ${draft.question}`} maxLength={200} placeholder={`Option ${index + 1}`} value={option.label} onChange={(event) => setDraft({ ...draft, options: (draft.options ?? []).map((item) => item.value === option.value ? { ...item, label: event.target.value } : item) })} />
            <button type="button" aria-label={`Move option ${index + 1} up`} disabled={index === 0} onClick={() => moveOption(index, index - 1)}>↑</button><button type="button" aria-label={`Move option ${index + 1} down`} disabled={index === (draft.options ?? []).length - 1} onClick={() => moveOption(index, index + 1)}>↓</button>
            <button type="button" aria-label={`Delete option ${option.label || index + 1}`} onClick={() => setDraft({ ...draft, options: (draft.options ?? []).filter((item) => item.value !== option.value) })}><TrashIcon /></button>
          </div>)}
          <button className="clinic-primary" type="button" onClick={() => setDraft({ ...draft, options: [...(draft.options ?? []), blankOption()] })}>+ Add Option</button>
        </div>}
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="service-dialog-footer"><button className="clinic-secondary" type="button" onClick={close}>Cancel</button><button className="clinic-primary" type="submit">{adding ? 'Add Question' : 'Save Changes'}</button></div>
      </form>}
    </dialog>
  </>;
}
