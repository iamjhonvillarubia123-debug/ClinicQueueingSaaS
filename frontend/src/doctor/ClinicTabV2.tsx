import { useMemo, useState } from 'react';

type Step = 1 | 2 | 3 | 4 | 5;
type ClinicStatus = 'DRAFT' | 'ACTIVE' | 'DISABLED';

type ClinicDraft = {
  id: string;
  name: string;
  shortCode: string;
  address: string;
  country: string;
  timeZone: string;
  contactNumber: string;
  email: string;
  description: string;
  status: ClinicStatus;
  lastStep: Step;
};

type DayHours = { day: string; open: boolean; opens: string; closes: string; maximumUntil: string };
type ServiceRow = { id: number; name: string; description: string; minutes: number; active: boolean };
type QuestionRow = { id: number; order: number; question: string; type: 'TEXT' | 'NUMBER' | 'BOOLEAN' | 'SINGLE_SELECT'; required: boolean };

type ClinicWorkingState = {
  clinic: ClinicDraft;
  hours: DayHours[];
  services: ServiceRow[];
  questions: QuestionRow[];
};

const blankClinic = (): ClinicDraft => ({
  id: crypto.randomUUID(),
  name: '', shortCode: '', address: '', country: 'Philippines', timeZone: 'Asia/Manila', contactNumber: '', email: '', description: '',
  status: 'DRAFT', lastStep: 1,
});

const defaultHours = (): DayHours[] => ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map((day, index) => ({
  day, open: index < 5, opens: index < 5 ? '08:00 AM' : '09:00 AM', closes: index < 5 ? '05:00 PM' : '01:00 PM', maximumUntil: index < 5 ? '06:00 PM' : '02:00 PM',
}));
const defaultServices = (): ServiceRow[] => [
  { id: 1, name: 'General Consultation', description: 'Regular check-up and consultation', minutes: 30, active: true },
  { id: 2, name: 'Follow-up Consultation', description: 'Follow-up check-up for existing patients', minutes: 20, active: true },
];
const defaultQuestions = (): QuestionRow[] => [
  { id: 1, order: 1, question: 'What is the reason for your visit?', type: 'SINGLE_SELECT', required: true },
  { id: 2, order: 2, question: 'Have you had this condition before?', type: 'BOOLEAN', required: true },
];
const newWorkingState = (): ClinicWorkingState => ({ clinic: blankClinic(), hours: defaultHours(), services: defaultServices(), questions: defaultQuestions() });

function Stepper({ step }: { step: Step }) {
  const labels = ['Basic Info', 'Hours', 'Services', 'Questions', 'Review'];
  return <div className="clinic-stepper" aria-label="Clinic setup progress">{labels.map((label, index) => {
    const number = (index + 1) as Step;
    return <div className="clinic-step" key={label}><span className={`clinic-step-dot${number < step ? ' is-complete' : ''}${number === step ? ' is-current' : ''}`}>{number < step ? '✓' : number}</span><span>{label}</span></div>;
  })}</div>;
}

function SplitAction({ primaryLabel, onPrimary, onDraft }: { primaryLabel: string; onPrimary: () => void; onDraft: () => void }) {
  const [open, setOpen] = useState(false);
  return <div className="clinic-split-action"><button className="clinic-primary" type="button" onClick={onPrimary}>{primaryLabel}</button><button className="clinic-primary clinic-split-toggle" type="button" aria-label="More save options" onClick={() => setOpen(v => !v)}>⌄</button>{open ? <div className="clinic-action-menu"><button type="button" onClick={() => { onDraft(); setOpen(false); }}>Save as Draft<span>You can continue later.</span></button></div> : null}</div>;
}

function BasicInformation({ value, onChange }: { value: ClinicDraft; onChange: (next: ClinicDraft) => void }) {
  return <div className="clinic-form-grid">
    <label>Clinic Name <b>*</b><input value={value.name} onChange={e => onChange({ ...value, name: e.target.value })} placeholder="Enter clinic name" /></label>
    <label>Short Code <small>(Optional)</small><input value={value.shortCode} onChange={e => onChange({ ...value, shortCode: e.target.value })} placeholder="e.g. NORTH" /></label>
    <label className="clinic-field-wide">Address <b>*</b><textarea value={value.address} onChange={e => onChange({ ...value, address: e.target.value })} placeholder="Enter complete address" /></label>
    <label>Country <b>*</b><select value={value.country} onChange={e => onChange({ ...value, country: e.target.value })}><option>Philippines</option><option>Other</option></select></label>
    <label>Timezone <b>*</b><select value={value.timeZone} onChange={e => onChange({ ...value, timeZone: e.target.value })}><option value="Asia/Manila">(GMT+08:00) Asia/Manila</option></select></label>
    <label>Contact Number <small>(Optional)</small><input value={value.contactNumber} onChange={e => onChange({ ...value, contactNumber: e.target.value })} placeholder="Enter contact number" /></label>
    <label>Email <small>(Optional)</small><input type="email" value={value.email} onChange={e => onChange({ ...value, email: e.target.value })} placeholder="Enter email address" /></label>
    <label className="clinic-field-wide">Description <small>(Optional)</small><textarea maxLength={250} value={value.description} onChange={e => onChange({ ...value, description: e.target.value })} placeholder="Brief description about this clinic" /><span className="clinic-count">{value.description.length} / 250</span></label>
  </div>;
}

function HoursEditor({ hours, setHours }: { hours: DayHours[]; setHours: (next: DayHours[]) => void }) {
  const update = (index: number, patch: Partial<DayHours>) => setHours(hours.map((row, i) => i === index ? { ...row, ...patch } : row));
  return <div className="clinic-hours-table"><div className="clinic-table-head"><span>Day</span><span>Opens</span><span>Closes</span><span>Maximum Operating Until</span><span>Closed</span></div>{hours.map((row, index) => <div className="clinic-hours-row" key={row.day}><strong>{row.day.slice(0, 3)}</strong><select disabled={!row.open} value={row.opens} onChange={e => update(index, { opens: e.target.value })}><option>08:00 AM</option><option>09:00 AM</option><option>10:00 AM</option></select><select disabled={!row.open} value={row.closes} onChange={e => update(index, { closes: e.target.value })}><option>01:00 PM</option><option>05:00 PM</option><option>06:00 PM</option></select><select disabled={!row.open} value={row.maximumUntil} onChange={e => update(index, { maximumUntil: e.target.value })}><option>02:00 PM</option><option>06:00 PM</option><option>07:00 PM</option></select><input aria-label={`${row.day} closed`} type="checkbox" checked={!row.open} onChange={e => update(index, { open: !e.target.checked })} /></div>)}</div>;
}

function ServicesEditor({ services, setServices }: { services: ServiceRow[]; setServices: (next: ServiceRow[]) => void }) {
  return <><div className="clinic-section-toolbar"><p>Add or manage the services offered in this clinic.</p><div><button className="clinic-secondary" type="button">Apply Doctor Defaults</button><button className="clinic-primary" type="button" onClick={() => setServices([...services, { id: Date.now(), name: 'New Service', description: 'Clinic-specific service', minutes: 30, active: true }])}>+ Add Service</button></div></div><div className="clinic-card-list">{services.map(service => <div className="clinic-list-row" key={service.id}><div><strong>{service.name}</strong><small>{service.description}</small></div><label className="clinic-inline-field"><span>Duration</span><input type="number" min={1} max={1440} value={service.minutes} onChange={e => setServices(services.map(row => row.id === service.id ? { ...row, minutes: Number(e.target.value) } : row))} /> min</label><button className={`clinic-status-pill${service.active ? ' is-active' : ''}`} type="button" onClick={() => setServices(services.map(row => row.id === service.id ? { ...row, active: !row.active } : row))}>{service.active ? 'Active' : 'Inactive'}</button><button className="clinic-kebab" type="button" aria-label={`Actions for ${service.name}`}>⋮</button></div>)}</div><div className="clinic-info-strip">ⓘ Service duration must be greater than 0 minutes and up to 24 hours (1,440 minutes).</div></>;
}

function QuestionsEditor({ questions, setQuestions }: { questions: QuestionRow[]; setQuestions: (next: QuestionRow[]) => void }) {
  return <><div className="clinic-section-toolbar"><p>Add questions to ask patients during booking. Maximum 5 active questions.</p><button className="clinic-secondary" disabled={questions.length >= 5} type="button" onClick={() => questions.length < 5 && setQuestions([...questions, { id: Date.now(), order: questions.length + 1, question: 'New booking question', type: 'TEXT', required: false }])}>+ Add Question</button></div><div className="clinic-question-list">{questions.map(q => <div className="clinic-question-row" key={q.id}><span className="clinic-order">{q.order}</span><input className="clinic-question-input" value={q.question} onChange={e => setQuestions(questions.map(row => row.id === q.id ? { ...row, question: e.target.value } : row))} /><select value={q.type} onChange={e => setQuestions(questions.map(row => row.id === q.id ? { ...row, type: e.target.value as QuestionRow['type'] } : row))}><option value="TEXT">Text</option><option value="NUMBER">Number</option><option value="BOOLEAN">Yes / No</option><option value="SINGLE_SELECT">Single Choice</option></select><label className="clinic-check"><input type="checkbox" checked={q.required} onChange={e => setQuestions(questions.map(row => row.id === q.id ? { ...row, required: e.target.checked } : row))} /> Required</label><button className="clinic-kebab" type="button" aria-label={`Actions for question ${q.order}`}>⋮</button></div>)}</div><div className="clinic-info-strip">ⓘ Supported question types: Text, Number, Yes / No, and Single Choice.</div></>;
}

function Review({ state }: { state: ClinicWorkingState }) {
  const { clinic, hours, services, questions } = state;
  return <div className="clinic-review-layout"><div className="clinic-review-stack"><div className="clinic-review-card"><h3>Basic Information</h3><dl><dt>Clinic Name</dt><dd>{clinic.name || 'Not entered'}</dd><dt>Address</dt><dd>{clinic.address || 'Not entered'}</dd><dt>Country</dt><dd>{clinic.country}</dd><dt>Timezone</dt><dd>{clinic.timeZone}</dd><dt>Contact Number</dt><dd>{clinic.contactNumber || 'Optional'}</dd></dl></div><div className="clinic-review-card"><h3>Clinic Hours</h3>{hours.filter(r => r.open).map(r => <p key={r.day}><strong>{r.day}</strong> {r.opens} – {r.closes} · Max until {r.maximumUntil}</p>)}</div><div className="clinic-review-card"><h3>Services ({services.length})</h3><p>{services.map(s => s.name).join(' · ') || 'No services configured'}</p></div><div className="clinic-review-card"><h3>Booking Questions ({questions.length})</h3><p>{questions.filter(q => q.required).length} required, {questions.filter(q => !q.required).length} optional</p></div></div><aside className="clinic-readiness-card"><span className="clinic-ready-icon">✓</span><h3>Activation Readiness</h3><p>Your clinic can be activated once required items are complete.</p><h4>Required for Activation</h4><p className="clinic-ready-line">Clinic Hours <span>✓</span></p><h4>Optional Configuration</h4><p className="clinic-ready-line">Services <span>○</span></p><p className="clinic-ready-line">Booking Questions <span>○</span></p><p className="clinic-ready-line">Secretaries <span>○</span></p><p className="clinic-ready-line">Public Information <span>○</span></p></aside></div>;
}

function ClinicWizard({ initial, onExit, onSave }: { initial: ClinicWorkingState; onExit: () => void; onSave: (state: ClinicWorkingState) => void }) {
  const [step, setStep] = useState<Step>(initial.clinic.lastStep);
  const [clinic, setClinic] = useState(initial.clinic);
  const [hours, setHours] = useState(initial.hours);
  const [services, setServices] = useState(initial.services);
  const [questions, setQuestions] = useState(initial.questions);
  const title = step === 1 ? (clinic.name ? 'Edit Clinic' : 'Add New Clinic') : step === 2 ? 'Clinic Hours (Required)' : step === 3 ? 'Services' : step === 4 ? 'Booking Questions' : 'Review Your Clinic';
  const canContinue = step !== 1 || Boolean(clinic.name.trim() && clinic.address.trim() && clinic.country && clinic.timeZone);
  const snapshot = (targetStep = step): ClinicWorkingState => ({ clinic: { ...clinic, status: 'DRAFT', lastStep: targetStep }, hours, services, questions });
  const saveDraft = () => onSave(snapshot(step));
  const next = () => { if (!canContinue) return; setStep(Math.min(5, step + 1) as Step); };
  return <section className="clinic-page"><button className="clinic-back-link" type="button" onClick={onExit}>← Back to Clinics</button><div className="clinic-page-heading"><h1>{title}</h1><p>{step === 1 ? 'Enter the basic details of your clinic.' : step === 5 ? 'Please review all information before creating your clinic.' : 'Configure this clinic now or save it as a draft and continue later.'}</p></div><Stepper step={step} /><div className="clinic-work-card"><div className="clinic-work-heading"><h2>{title}</h2></div>{step === 1 ? <BasicInformation value={clinic} onChange={setClinic} /> : null}{step === 2 ? <HoursEditor hours={hours} setHours={setHours} /> : null}{step === 3 ? <ServicesEditor services={services} setServices={setServices} /> : null}{step === 4 ? <QuestionsEditor questions={questions} setQuestions={setQuestions} /> : null}{step === 5 ? <Review state={{ clinic, hours, services, questions }} /> : null}<div className="clinic-footer-actions">{step === 1 ? <button className="clinic-secondary" type="button" onClick={onExit}>Cancel</button> : <button className="clinic-secondary" type="button" onClick={() => setStep((step - 1) as Step)}>Back</button>}<SplitAction primaryLabel={step === 5 ? 'Create Clinic' : 'Save and Continue'} onPrimary={step === 5 ? () => onSave(snapshot(5)) : next} onDraft={saveDraft} /></div></div></section>;
}

function ClinicList({ records, onAdd, onOpen }: { records: ClinicWorkingState[]; onAdd: () => void; onOpen: (record: ClinicWorkingState) => void }) {
  const [filter, setFilter] = useState<'ALL' | ClinicStatus>('ALL');
  const [search, setSearch] = useState('');
  const filtered = useMemo(() => records.filter(r => (filter === 'ALL' || r.clinic.status === filter) && (r.clinic.name || 'Untitled Clinic').toLowerCase().includes(search.toLowerCase())), [records, filter, search]);
  const count = (status: ClinicStatus) => records.filter(r => r.clinic.status === status).length;
  return <section className="clinic-page"><div className="clinic-list-heading"><div><h1>Clinics</h1><p>Manage your practice locations. You can view, edit, activate, disable, or continue setup.</p></div><button className="clinic-primary" type="button" onClick={onAdd}>+ Add New Clinic</button></div><div className="clinic-list-controls"><div className="clinic-tabs"><button className={filter === 'ALL' ? 'is-active' : ''} type="button" onClick={() => setFilter('ALL')}>All Clinics <span>{records.length}</span></button>{(['ACTIVE', 'DRAFT', 'DISABLED'] as const).map(status => <button className={filter === status ? 'is-active' : ''} type="button" onClick={() => setFilter(status)} key={status}>{status.charAt(0) + status.slice(1).toLowerCase()} <span>{count(status)}</span></button>)}</div><input className="clinic-search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search clinics..." /></div>{filtered.length === 0 ? <div className="clinic-empty"><div className="clinic-empty-icon">+</div><h2>No clinics yet</h2><p>Create your first clinic and save it as a draft while you complete setup.</p><button className="clinic-primary" type="button" onClick={onAdd}>+ Add New Clinic</button></div> : <div className="clinic-list-card">{filtered.map(record => { const c = record.clinic; return <div className="clinic-record-row" key={c.id}><div className="clinic-record-icon">+</div><div className="clinic-record-main"><div><strong>{c.name || 'Untitled Clinic'}</strong> <span className="clinic-mini-badge">{c.status}</span></div><span>{c.address || 'Address not entered'}</span><small>{c.country} · {c.timeZone}</small></div><div className="clinic-record-status"><span className="clinic-status-pill">{c.status}</span><small>{c.status === 'DRAFT' ? 'Ready to continue setup' : ''}</small></div><div className="clinic-record-secretary"><strong>Secretary</strong><small>Not assigned</small></div><button className="clinic-secondary" type="button" onClick={() => onOpen(record)}>Open</button><button className="clinic-kebab" type="button" aria-label={`Actions for ${c.name || 'Untitled Clinic'}`} onClick={() => onOpen(record)}>⋮</button></div>})}</div>}</section>;
}

export function ClinicTabPageV2() {
  const [records, setRecords] = useState<ClinicWorkingState[]>([]);
  const [editing, setEditing] = useState<ClinicWorkingState | null>(null);
  function save(state: ClinicWorkingState) {
    setRecords(current => {
      const exists = current.some(record => record.clinic.id === state.clinic.id);
      return exists ? current.map(record => record.clinic.id === state.clinic.id ? state : record) : [...current, state];
    });
    setEditing(null);
  }
  return editing ? <ClinicWizard initial={editing} onExit={() => setEditing(null)} onSave={save} /> : <ClinicList records={records} onAdd={() => setEditing(newWorkingState())} onOpen={setEditing} />;
}
