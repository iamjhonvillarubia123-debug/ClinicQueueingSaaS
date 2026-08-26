import { useEffect, useMemo, useState } from 'react';
import { apiRequest } from '../api/client';

type Step = 1 | 2 | 3 | 4 | 5;
type ClinicStatus = 'DRAFT' | 'ACTIVE' | 'DISABLED';

type ClinicDraft = {
  name: string;
  shortCode: string;
  address: string;
  country: string;
  timeZone: string;
  contactNumber: string;
  email: string;
  description: string;
};

type ClinicRecord = ClinicDraft & { id: string; status: ClinicStatus };

type PracticeLocationResponse = {
  id: string;
  lifecycleStatus: ClinicStatus | 'PERMANENTLY_DELETED';
  name: string | null;
  addressLine1: string | null;
  contactNumber: string | null;
  countryCode: string | null;
  timeZone: string | null;
};

type DayHours = { day: string; open: boolean; opens: string; closes: string; maximumUntil: string };
type ServiceRow = { id: number; name: string; description: string; minutes: number; active: boolean };
type QuestionRow = { id: number; order: number; question: string; type: 'TEXT' | 'NUMBER' | 'BOOLEAN' | 'SINGLE_SELECT'; required: boolean };

const initialDraft: ClinicDraft = {
  name: '', shortCode: '', address: '', country: 'Philippines', timeZone: 'Asia/Manila', contactNumber: '', email: '', description: '',
};

const initialHours: DayHours[] = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map((day, index) => ({
  day,
  open: index < 5,
  opens: index < 5 ? '08:00 AM' : '09:00 AM',
  closes: index < 5 ? '05:00 PM' : '01:00 PM',
  maximumUntil: index < 5 ? '06:00 PM' : '02:00 PM',
}));

const initialServices: ServiceRow[] = [
  { id: 1, name: 'General Consultation', description: 'Regular check-up and consultation', minutes: 30, active: true },
  { id: 2, name: 'Follow-up Consultation', description: 'Follow-up check-up for existing patients', minutes: 20, active: true },
];

const initialQuestions: QuestionRow[] = [
  { id: 1, order: 1, question: 'What is the reason for your visit?', type: 'SINGLE_SELECT', required: true },
  { id: 2, order: 2, question: 'Have you had this condition before?', type: 'BOOLEAN', required: true },
];

function toClinicRecord(location: PracticeLocationResponse): ClinicRecord | null {
  if (location.lifecycleStatus === 'PERMANENTLY_DELETED') return null;
  return {
    id: location.id,
    name: location.name ?? '',
    shortCode: '',
    address: location.addressLine1 ?? '',
    country: location.countryCode === 'PH' || !location.countryCode ? 'Philippines' : location.countryCode,
    timeZone: location.timeZone ?? 'Asia/Manila',
    contactNumber: location.contactNumber ?? '',
    email: '',
    description: '',
    status: location.lifecycleStatus,
  };
}

function Stepper({ step }: { step: Step }) {
  const labels = ['Basic Info', 'Hours', 'Services', 'Questions', 'Review'];
  return <div className="clinic-stepper" aria-label="Clinic setup progress">{labels.map((label, index) => {
    const number = (index + 1) as Step;
    const complete = number < step;
    const current = number === step;
    return <div className="clinic-step" key={label}><span className={`clinic-step-dot${complete ? ' is-complete' : ''}${current ? ' is-current' : ''}`}>{complete ? '✓' : number}</span><span>{label}</span></div>;
  })}</div>;
}

function SplitAction({ primaryLabel, onPrimary, onDraft }: { primaryLabel: string; onPrimary: () => void; onDraft: () => void }) {
  const [open, setOpen] = useState(false);
  return <div className="clinic-split-action"><button className="clinic-primary" type="button" onClick={onPrimary}>{primaryLabel}</button><button className="clinic-primary clinic-split-toggle" type="button" aria-label="More save options" onClick={() => setOpen((value) => !value)}>⌄</button>{open ? <div className="clinic-action-menu"><button type="button" onClick={() => { onDraft(); setOpen(false); }}>Save as Draft<span>You can continue later.</span></button></div> : null}</div>;
}

function BasicInformation({ value, onChange }: { value: ClinicDraft; onChange: (next: ClinicDraft) => void }) {
  return <div className="clinic-form-grid">
    <label>Clinic Name <b>*</b><input value={value.name} onChange={(e) => onChange({ ...value, name: e.target.value })} placeholder="Enter clinic name" /></label>
    <label>Short Code <small>(Optional)</small><input value={value.shortCode} onChange={(e) => onChange({ ...value, shortCode: e.target.value })} placeholder="e.g. NORTH" /></label>
    <label className="clinic-field-wide">Address <b>*</b><textarea value={value.address} onChange={(e) => onChange({ ...value, address: e.target.value })} placeholder="Enter complete address" /></label>
    <label>Country <b>*</b><select value={value.country} onChange={(e) => onChange({ ...value, country: e.target.value })}><option>Philippines</option><option>Other</option></select></label>
    <label>Timezone <b>*</b><select value={value.timeZone} onChange={(e) => onChange({ ...value, timeZone: e.target.value })}><option value="Asia/Manila">(GMT+08:00) Asia/Manila</option></select></label>
    <label>Contact Number <small>(Optional)</small><input value={value.contactNumber} onChange={(e) => onChange({ ...value, contactNumber: e.target.value })} placeholder="Enter contact number" /></label>
    <label>Email <small>(Optional)</small><input type="email" value={value.email} onChange={(e) => onChange({ ...value, email: e.target.value })} placeholder="Enter email address" /></label>
    <label className="clinic-field-wide">Description <small>(Optional)</small><textarea maxLength={250} value={value.description} onChange={(e) => onChange({ ...value, description: e.target.value })} placeholder="Brief description about this clinic" /><span className="clinic-count">{value.description.length} / 250</span></label>
  </div>;
}

function HoursEditor({ hours, setHours }: { hours: DayHours[]; setHours: (hours: DayHours[]) => void }) {
  const update = (index: number, patch: Partial<DayHours>) => setHours(hours.map((row, rowIndex) => rowIndex === index ? { ...row, ...patch } : row));
  return <div className="clinic-hours-table"><div className="clinic-table-head"><span>Day</span><span>Opens</span><span>Closes</span><span>Maximum Operating Until</span><span>Closed</span></div>{hours.map((row, index) => <div className="clinic-hours-row" key={row.day}><strong>{row.day.slice(0, 3)}</strong><select disabled={!row.open} value={row.opens} onChange={(e) => update(index, { opens: e.target.value })}><option>08:00 AM</option><option>09:00 AM</option><option>10:00 AM</option></select><select disabled={!row.open} value={row.closes} onChange={(e) => update(index, { closes: e.target.value })}><option>01:00 PM</option><option>05:00 PM</option><option>06:00 PM</option></select><select disabled={!row.open} value={row.maximumUntil} onChange={(e) => update(index, { maximumUntil: e.target.value })}><option>02:00 PM</option><option>06:00 PM</option><option>07:00 PM</option></select><input aria-label={`${row.day} closed`} type="checkbox" checked={!row.open} onChange={(e) => update(index, { open: !e.target.checked })} /></div>)}</div>;
}

function ServicesEditor({ services, setServices }: { services: ServiceRow[]; setServices: (value: ServiceRow[]) => void }) {
  function addService() { setServices([...services, { id: Date.now(), name: 'New Service', description: 'Clinic-specific service', minutes: 30, active: true }]); }
  return <><div className="clinic-section-toolbar"><p>Add or manage the services offered in this clinic.</p><div><button className="clinic-secondary" type="button">Apply Doctor Defaults</button><button className="clinic-primary" type="button" onClick={addService}>+ Add Service</button></div></div><div className="clinic-card-list">{services.map((service) => <div className="clinic-list-row" key={service.id}><div><strong>{service.name}</strong><small>{service.description}</small></div><label className="clinic-inline-field"><span>Duration</span><input type="number" min={1} max={1440} value={service.minutes} onChange={(e) => setServices(services.map((row) => row.id === service.id ? { ...row, minutes: Number(e.target.value) } : row))} /> min</label><button className={`clinic-status-pill${service.active ? ' is-active' : ''}`} type="button" onClick={() => setServices(services.map((row) => row.id === service.id ? { ...row, active: !row.active } : row))}>{service.active ? 'Active' : 'Inactive'}</button><button className="clinic-kebab" type="button" aria-label={`Actions for ${service.name}`}>⋮</button></div>)}</div><div className="clinic-info-strip">ⓘ Service duration must be greater than 0 minutes and up to 24 hours (1,440 minutes).</div></>;
}

function QuestionsEditor({ questions, setQuestions }: { questions: QuestionRow[]; setQuestions: (value: QuestionRow[]) => void }) {
  function addQuestion() { if (questions.length >= 5) return; setQuestions([...questions, { id: Date.now(), order: questions.length + 1, question: 'New booking question', type: 'TEXT', required: false }]); }
  return <><div className="clinic-section-toolbar"><p>Add questions to ask patients during booking. Maximum 5 active questions.</p><button className="clinic-secondary" disabled={questions.length >= 5} type="button" onClick={addQuestion}>+ Add Question</button></div><div className="clinic-question-list">{questions.map((question) => <div className="clinic-question-row" key={question.id}><span className="clinic-order">{question.order}</span><input className="clinic-question-input" value={question.question} onChange={(e) => setQuestions(questions.map((row) => row.id === question.id ? { ...row, question: e.target.value } : row))} /><select value={question.type} onChange={(e) => setQuestions(questions.map((row) => row.id === question.id ? { ...row, type: e.target.value as QuestionRow['type'] } : row))}><option value="TEXT">Text</option><option value="NUMBER">Number</option><option value="BOOLEAN">Yes / No</option><option value="SINGLE_SELECT">Single Choice</option></select><label className="clinic-check"><input type="checkbox" checked={question.required} onChange={(e) => setQuestions(questions.map((row) => row.id === question.id ? { ...row, required: e.target.checked } : row))} /> Required</label><button className="clinic-kebab" type="button" aria-label={`Actions for question ${question.order}`}>⋮</button></div>)}</div><div className="clinic-info-strip">ⓘ Supported question types: Text, Number, Yes / No, and Single Choice.</div></>;
}

function Review({ draft, hours, services, questions }: { draft: ClinicDraft; hours: DayHours[]; services: ServiceRow[]; questions: QuestionRow[] }) {
  return <div className="clinic-review-layout"><div className="clinic-review-stack"><div className="clinic-review-card"><h3>Basic Information</h3><dl><dt>Clinic Name</dt><dd>{draft.name || 'Not entered'}</dd><dt>Address</dt><dd>{draft.address || 'Not entered'}</dd><dt>Country</dt><dd>{draft.country}</dd><dt>Timezone</dt><dd>{draft.timeZone}</dd><dt>Contact Number</dt><dd>{draft.contactNumber || 'Optional'}</dd></dl></div><div className="clinic-review-card"><h3>Clinic Hours</h3>{hours.filter((row) => row.open).map((row) => <p key={row.day}><strong>{row.day}</strong> {row.opens} – {row.closes} · Max until {row.maximumUntil}</p>)}</div><div className="clinic-review-card"><h3>Services ({services.length})</h3><p>{services.map((service) => service.name).join(' · ') || 'No services configured'}</p></div><div className="clinic-review-card"><h3>Booking Questions ({questions.length})</h3><p>{questions.filter((question) => question.required).length} required, {questions.filter((question) => !question.required).length} optional</p></div></div><aside className="clinic-readiness-card"><span className="clinic-ready-icon">✓</span><h3>Activation Readiness</h3><p>Your clinic can be activated once required items are complete.</p><h4>Required for Activation</h4><p className="clinic-ready-line">Clinic Hours <span>✓</span></p><h4>Optional Configuration</h4><p className="clinic-ready-line">Services <span>○</span></p><p className="clinic-ready-line">Booking Questions <span>○</span></p><p className="clinic-ready-line">Secretaries <span>○</span></p><p className="clinic-ready-line">Public Information <span>○</span></p></aside></div>;
}

function ClinicWizard({ onExit, onSaved }: { onExit: () => void; onSaved: (clinic: ClinicDraft, status: ClinicStatus) => Promise<void> }) {
  const [step, setStep] = useState<Step>(1);
  const [draft, setDraft] = useState(initialDraft);
  const [hours, setHours] = useState(initialHours);
  const [services, setServices] = useState(initialServices);
  const [questions, setQuestions] = useState(initialQuestions);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const title = step === 1 ? 'Add New Clinic' : step === 2 ? 'Clinic Hours (Required)' : step === 3 ? 'Services' : step === 4 ? 'Booking Questions' : 'Review Your Clinic';
  const canContinue = step !== 1 || Boolean(draft.name.trim() && draft.address.trim() && draft.country && draft.timeZone);
  async function saveDraft() {
    if (saving) return;
    setSaveError('');
    setSaving(true);
    try { await onSaved(draft, 'DRAFT'); }
    catch (error) { setSaveError(error instanceof Error ? error.message : 'Unable to save this clinic draft.'); }
    finally { setSaving(false); }
  }
  function next() { if (!canContinue) return; setStep((Math.min(5, step + 1)) as Step); }
  return <section className="clinic-page"><button className="clinic-back-link" type="button" onClick={onExit}>← Back to Clinics</button><div className="clinic-page-heading"><h1>{step === 1 ? 'Add New Clinic' : title}</h1><p>{step === 1 ? 'Enter the basic details of your clinic.' : step === 5 ? 'Please review all information before creating your clinic.' : 'Configure this clinic now or save it as a draft and continue later.'}</p></div><Stepper step={step} /><div className="clinic-work-card"><div className="clinic-work-heading"><h2>{title}</h2>{step === 1 ? <p>Start with the clinic identity and location details.</p> : null}</div>{step === 1 ? <BasicInformation value={draft} onChange={setDraft} /> : null}{step === 2 ? <HoursEditor hours={hours} setHours={setHours} /> : null}{step === 3 ? <ServicesEditor services={services} setServices={setServices} /> : null}{step === 4 ? <QuestionsEditor questions={questions} setQuestions={setQuestions} /> : null}{step === 5 ? <Review draft={draft} hours={hours} services={services} questions={questions} /> : null}{saveError ? <div className="form-error" role="alert">{saveError}</div> : null}<div className="clinic-footer-actions">{step === 1 ? <button className="clinic-secondary" type="button" onClick={onExit}>Cancel</button> : <button className="clinic-secondary" type="button" onClick={() => setStep((step - 1) as Step)}>Back</button>}<SplitAction primaryLabel={step === 5 ? 'Create Clinic' : 'Save and Continue'} onPrimary={step === 5 ? () => { void saveDraft(); } : next} onDraft={() => { void saveDraft(); }} /></div></div></section>;
}

function ClinicList({ clinics, onAdd }: { clinics: ClinicRecord[]; onAdd: () => void }) {
  const [filter, setFilter] = useState<'ALL' | ClinicStatus>('ALL');
  const [search, setSearch] = useState('');
  const filtered = useMemo(() => clinics.filter((clinic) => (filter === 'ALL' || clinic.status === filter) && clinic.name.toLowerCase().includes(search.toLowerCase())), [clinics, filter, search]);
  return <section className="clinic-page"><div className="clinic-list-heading"><div><h1>Clinics</h1><p>Manage your practice locations. You can view, edit, activate, disable, or continue setup.</p></div><button className="clinic-primary" type="button" onClick={onAdd}>+ Add New Clinic</button></div><div className="clinic-list-controls"><div className="clinic-tabs">{(['ALL', 'ACTIVE', 'DRAFT', 'DISABLED'] as const).map((value) => <button className={filter === value ? 'is-active' : ''} type="button" onClick={() => setFilter(value)} key={value}>{value === 'ALL' ? 'All Clinics' : value.charAt(0) + value.slice(1).toLowerCase()} <span>{value === 'ALL' ? clinics.length : clinics.filter((clinic) => clinic.status === value).length}</span></button>)}</div><input className="clinic-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search clinics…" /></div><div className="clinic-table-card">{filtered.length === 0 ? <div className="clinic-empty"><div className="clinic-empty-icon">+</div><h2>No clinics yet</h2><p>Create your first clinic to begin configuration.</p><button className="clinic-primary" type="button" onClick={onAdd}>Add New Clinic</button></div> : filtered.map((clinic) => <article className="clinic-clinic-row" key={clinic.id}><div className="clinic-building-icon">+</div><div className="clinic-clinic-copy"><strong>{clinic.name || 'Untitled Clinic'} <span>{clinic.status}</span></strong><p>{clinic.address || 'Address not entered'}</p><small>{clinic.country} · {clinic.timeZone}</small></div><div><span className={`clinic-status-pill${clinic.status === 'ACTIVE' ? ' is-active' : ''}`}>{clinic.status}</span><small className="clinic-readiness">{clinic.status === 'DRAFT' ? 'Ready to continue setup' : ''}</small></div><div className="clinic-secretary"><strong>Secretary</strong><span>Not assigned</span></div><button className="clinic-secondary" type="button">Open</button><button className="clinic-kebab" type="button" aria-label={`Actions for ${clinic.name}`}>⋮</button></article>)}</div></section>;
}

export function ClinicTabPage() {
  const [mode, setMode] = useState<'list' | 'create'>('list');
  const [clinics, setClinics] = useState<ClinicRecord[]>([]);
  const [loadError, setLoadError] = useState('');

  async function loadClinics() {
    const locations = await apiRequest<PracticeLocationResponse[]>('/practice-location');
    const mapped = locations.map(toClinicRecord).filter((clinic): clinic is ClinicRecord => clinic !== null);
    setClinics(mapped);
  }

  useEffect(() => {
    let cancelled = false;
    void apiRequest<PracticeLocationResponse[]>('/practice-location')
      .then((locations) => {
        if (cancelled) return;
        setClinics(locations.map(toClinicRecord).filter((clinic): clinic is ClinicRecord => clinic !== null));
        setLoadError('');
      })
      .catch((error) => {
        if (cancelled) return;
        setLoadError(error instanceof Error ? error.message : 'Unable to load clinics.');
      });
    return () => { cancelled = true; };
  }, []);

  async function saved(clinic: ClinicDraft, _status: ClinicStatus) {
    await apiRequest<PracticeLocationResponse>('/practice-location', {
      method: 'POST',
      body: {
        name: clinic.name.trim() || undefined,
        addressLine1: clinic.address.trim() || undefined,
        contactNumber: clinic.contactNumber.trim() || undefined,
      },
    });
    await loadClinics();
    setMode('list');
  }

  if (mode === 'create') return <ClinicWizard onExit={() => setMode('list')} onSaved={saved} />;
  return <>{loadError ? <div className="form-error" role="alert">{loadError}</div> : null}<ClinicList clinics={clinics} onAdd={() => setMode('create')} /></>;
}
