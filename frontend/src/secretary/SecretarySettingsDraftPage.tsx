import { DragEvent, FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ApiError, apiRequest } from '../api/client';

type DraftStatus = 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'RETURNED_FOR_REWORK';
type Weekday = 'MONDAY' | 'TUESDAY' | 'WEDNESDAY' | 'THURSDAY' | 'FRIDAY' | 'SATURDAY' | 'SUNDAY';
type ServiceStatus = 'ACTIVE' | 'INACTIVE';
type QuestionType = 'TEXT' | 'NUMBER' | 'BOOLEAN' | 'SINGLE_SELECT';
type EditorSection = 'clinic' | 'content' | 'schedules';
type ScheduleRow = { weekday: Weekday; isOpen: boolean; opensAtLocal: string | null; closesAtLocal: string | null; maximumOnlineBookingUntilLocal: string | null; maximumOperatingUntilLocal: string | null };
type ProposedSchedule = { weekday: Weekday; proposedIsOpen: boolean; proposedOpensAtLocal: string | null; proposedClosesAtLocal: string | null; proposedMaximumOnlineBookingUntilLocal: string | null; proposedMaximumOperatingUntilLocal: string | null };
type ServiceRow = { id: string; name: string; durationMinutes: number; status: ServiceStatus; displayOrder: number };
type ServiceProposal = { id: string; practiceLocationServiceId: string | null; proposedName: string; proposedDurationMinutes: number; proposedStatus: ServiceStatus; proposedDisplayOrder: number };
type QuestionRow = { id: string; questionText: string; helpText: string | null; type: QuestionType; isRequired: boolean; displayOrder: number; isActive: boolean; textMaximumLength: number | null; numberMinimum: number | string | null; numberMaximum: number | string | null; selectOptions: unknown };
type QuestionProposal = { id: string; bookingQuestionId: string | null; proposedQuestionText: string; proposedHelpText: string | null; proposedType: QuestionType; proposedIsRequired: boolean; proposedDisplayOrder: number; proposedIsActive: boolean; proposedTextMaximumLength: number | null; proposedNumberMinimum: number | string | null; proposedNumberMaximum: number | string | null; proposedSelectOptions: unknown };
type ExceptionProposal = { id: string; serviceDate: string; proposedIsOpen: boolean; proposedOpensAtLocal: string | null; proposedClosesAtLocal: string | null; proposedMaximumOnlineBookingUntilLocal: string | null; proposedMaximumOperatingUntilLocal: string | null };
type ClinicDetailsProposal = { id: string; proposedName: string; proposedAddressLine1: string; proposedAddressLine2: string | null; proposedCityMunicipality: string; proposedProvince: string; proposedPostalCode: string | null; proposedContactNumber: string; proposedCountryCode: string; proposedTimeZone: string };
type ClinicDetailsForm = { name: string; addressLine1: string; addressLine2: string; cityMunicipality: string; province: string; postalCode: string; contactNumber: string; countryCode: string; timeZone: string };
type ScheduleForm = { weekday: Weekday; isOpen: boolean; opensAtLocal: string; closesAtLocal: string; maximumOnlineBookingUntilLocal: string; maximumOperatingUntilLocal: string };
type ServiceForm = { name: string; durationMinutes: string; status: ServiceStatus; displayOrder: string };
type QuestionForm = { questionText: string; helpText: string; type: QuestionType; isRequired: boolean; displayOrder: string; isActive: boolean; selectOptionsText: string };
type ServiceMutationResult = { saved: true; proposalId: string; practiceLocationServiceId: string | null; proposedStatus: ServiceStatus; proposedDisplayOrder: number };
type QuestionMutationResult = { saved: true; proposalId: string; bookingQuestionId: string | null; proposedIsActive: boolean };
type DraftDetail = {
  id: string; status: DraftStatus; submittedAt: string | null; reviewedAt: string | null; reviewComment: string | null;
  practiceLocation: {
    id: string; name: string | null; addressLine1: string | null; addressLine2: string | null; cityMunicipality: string | null; province: string | null; postalCode: string | null; contactNumber: string | null; countryCode: string | null; lifecycleStatus: string; timeZone: string | null;
    currentRegularPracticeStaff: { canManageClinicDetails: boolean; canManageServices: boolean; canManageBookingQuestions: boolean; canManageSchedules: boolean } | null;
    practiceSchedules: ScheduleRow[]; services: ServiceRow[]; bookingQuestions: QuestionRow[];
  };
  proposedClinicDetails: ClinicDetailsProposal | null;
  proposedPracticeSchedules: ProposedSchedule[]; proposedServices: ServiceProposal[]; proposedBookingQuestions: QuestionProposal[]; proposedScheduleExceptions: ExceptionProposal[];
};

const weekdays: Weekday[] = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'];
const blankClinicDetails: ClinicDetailsForm = { name: '', addressLine1: '', addressLine2: '', cityMunicipality: '', province: '', postalCode: '', contactNumber: '', countryCode: '', timeZone: '' };
const timeOnly = (value: string | null | undefined) => { if (!value) return ''; const match = /T(\d{2}):(\d{2})/.exec(value); return match ? `${match[1]}:${match[2]}` : value.slice(0, 5); };
const dateOnly = (value: string) => /^(\d{4}-\d{2}-\d{2})/.exec(value)?.[1] ?? value;
const dayLabel = (value: Weekday) => value.charAt(0) + value.slice(1).toLowerCase();
const statusLabel = (value: DraftStatus) => value === 'RETURNED_FOR_REWORK' ? 'Returned for rework' : value.charAt(0) + value.slice(1).toLowerCase();
const questionTypeLabel = (value: QuestionType) => value === 'SINGLE_SELECT' ? 'Single select' : value === 'BOOLEAN' ? 'Yes / No' : value.charAt(0) + value.slice(1).toLowerCase();
const errorMessage = (error: unknown) => error instanceof ApiError ? error.message : 'Unable to complete this settings action. Please try again.';
const selectOptions = (value: unknown) => Array.isArray(value) ? value : undefined;
const selectOptionsText = (value: unknown) => Array.isArray(value) ? value.map((item) => typeof item === 'object' && item !== null && typeof (item as { label?: unknown }).label === 'string' ? (item as { label: string }).label : '').filter(Boolean).join('\n') : '';
const parsedSelectOptions = (value: string) => value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((label) => ({ value: label, label }));

function scheduleForms(detail: DraftDetail): ScheduleForm[] {
  const effective = new Map(detail.practiceLocation.practiceSchedules.map((row) => [row.weekday, row]));
  const proposed = new Map(detail.proposedPracticeSchedules.map((row) => [row.weekday, row]));
  return weekdays.map((weekday) => {
    const p = proposed.get(weekday); const e = effective.get(weekday);
    return { weekday, isOpen: p?.proposedIsOpen ?? e?.isOpen ?? false, opensAtLocal: timeOnly(p?.proposedOpensAtLocal ?? e?.opensAtLocal), closesAtLocal: timeOnly(p?.proposedClosesAtLocal ?? e?.closesAtLocal), maximumOnlineBookingUntilLocal: timeOnly(p?.proposedMaximumOnlineBookingUntilLocal ?? e?.maximumOnlineBookingUntilLocal), maximumOperatingUntilLocal: timeOnly(p?.proposedMaximumOperatingUntilLocal ?? e?.maximumOperatingUntilLocal) };
  });
}

function clinicDetailsForm(detail: DraftDetail): ClinicDetailsForm {
  const e = detail.practiceLocation; const p = detail.proposedClinicDetails;
  return { name: p?.proposedName ?? e.name ?? '', addressLine1: p?.proposedAddressLine1 ?? e.addressLine1 ?? '', addressLine2: p?.proposedAddressLine2 ?? e.addressLine2 ?? '', cityMunicipality: p?.proposedCityMunicipality ?? e.cityMunicipality ?? '', province: p?.proposedProvince ?? e.province ?? '', postalCode: p?.proposedPostalCode ?? e.postalCode ?? '', contactNumber: p?.proposedContactNumber ?? e.contactNumber ?? '', countryCode: p?.proposedCountryCode ?? e.countryCode ?? '', timeZone: p?.proposedTimeZone ?? e.timeZone ?? '' };
}

function TrashIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M9 3h6l1 2h4v2H4V5h4l1-2Zm-2 6h10l-.7 11H7.7L7 9Zm3 2v7m4-7v7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}
function DragHandle() { return <span className="proposal-drag-handle" aria-hidden="true">⋮⋮</span>; }
function moveKey(keys: string[], from: string, to: string) {
  const fromIndex = keys.indexOf(from); const toIndex = keys.indexOf(to);
  if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return keys;
  const next = [...keys]; const [moved] = next.splice(fromIndex, 1); next.splice(toIndex, 0, moved); return next;
}

export function SecretarySettingsDraftPage() {
  const { draftId } = useParams();
  const [detail, setDetail] = useState<DraftDetail | null>(null);
  const [activeSection, setActiveSection] = useState<EditorSection>('clinic');
  const [clinicDetails, setClinicDetails] = useState<ClinicDetailsForm>(blankClinicDetails);
  const [schedules, setSchedules] = useState<ScheduleForm[]>([]);
  const [services, setServices] = useState<Record<string, ServiceForm>>({});
  const [questions, setQuestions] = useState<Record<string, QuestionForm>>({});
  const [serviceOrder, setServiceOrder] = useState<string[]>([]);
  const [questionOrder, setQuestionOrder] = useState<string[]>([]);
  const [draggedService, setDraggedService] = useState('');
  const [draggedQuestion, setDraggedQuestion] = useState('');
  const [serviceDragOrigin, setServiceDragOrigin] = useState<string[]>([]);
  const [questionDragOrigin, setQuestionDragOrigin] = useState<string[]>([]);
  const [newService, setNewService] = useState<ServiceForm>({ name: '', durationMinutes: '15', status: 'ACTIVE', displayOrder: '0' });
  const [newQuestion, setNewQuestion] = useState<QuestionForm>({ questionText: '', helpText: '', type: 'TEXT', isRequired: false, displayOrder: '0', isActive: true, selectOptionsText: '' });
  const [exception, setException] = useState({ serviceDate: '', isOpen: false, opensAtLocal: '', closesAtLocal: '', maximumOnlineBookingUntilLocal: '', maximumOperatingUntilLocal: '' });
  const [proposalCountDelta, setProposalCountDelta] = useState(0);
  const knownProposalIds = useRef<Set<string>>(new Set());
  const [loading, setLoading] = useState(true); const [working, setWorking] = useState(''); const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const editable = detail?.status === 'DRAFT' || detail?.status === 'RETURNED_FOR_REWORK';

  function recordProposal(kind: 'service' | 'question', proposalId: string) {
    const token = `${kind}:${proposalId}`;
    if (knownProposalIds.current.has(token)) return;
    knownProposalIds.current.add(token);
    setProposalCountDelta((current) => current + 1);
  }

  async function load(showLoader = false) {
    if (!draftId) return; if (showLoader) setLoading(true); setError('');
    try {
      const response = await apiRequest<DraftDetail>(`/secretary-settings-drafts/${encodeURIComponent(draftId)}`);
      setDetail(response); setClinicDetails(clinicDetailsForm(response)); setSchedules(scheduleForms(response));
      knownProposalIds.current = new Set([
        ...response.proposedServices.map((row) => `service:${row.id}`),
        ...response.proposedBookingQuestions.map((row) => `question:${row.id}`),
      ]);
      setProposalCountDelta(0);
      const serviceState: Record<string, ServiceForm> = {};
      for (const row of response.practiceLocation.services) {
        const p = response.proposedServices.find((item) => item.practiceLocationServiceId === row.id);
        serviceState[row.id] = { name: p?.proposedName ?? row.name, durationMinutes: String(p?.proposedDurationMinutes ?? row.durationMinutes), status: p?.proposedStatus ?? row.status, displayOrder: String(p?.proposedDisplayOrder ?? row.displayOrder) };
      }
      for (const p of response.proposedServices.filter((item) => !item.practiceLocationServiceId)) serviceState[`proposal:${p.id}`] = { name: p.proposedName, durationMinutes: String(p.proposedDurationMinutes), status: p.proposedStatus, displayOrder: String(p.proposedDisplayOrder) };
      setServices(serviceState);
      setServiceOrder(Object.keys(serviceState).filter((key) => serviceState[key].status === 'ACTIVE').sort((a, b) => Number(serviceState[a].displayOrder) - Number(serviceState[b].displayOrder)));

      const questionState: Record<string, QuestionForm> = {};
      for (const row of response.practiceLocation.bookingQuestions) {
        const p = response.proposedBookingQuestions.find((item) => item.bookingQuestionId === row.id);
        const options = p?.proposedSelectOptions ?? row.selectOptions;
        questionState[row.id] = { questionText: p?.proposedQuestionText ?? row.questionText, helpText: p?.proposedHelpText ?? row.helpText ?? '', type: p?.proposedType ?? row.type, isRequired: p?.proposedIsRequired ?? row.isRequired, displayOrder: String(p?.proposedDisplayOrder ?? row.displayOrder), isActive: p?.proposedIsActive ?? row.isActive, selectOptionsText: selectOptionsText(options) };
      }
      for (const p of response.proposedBookingQuestions.filter((item) => !item.bookingQuestionId)) questionState[`proposal:${p.id}`] = { questionText: p.proposedQuestionText, helpText: p.proposedHelpText ?? '', type: p.proposedType, isRequired: p.proposedIsRequired, displayOrder: String(p.proposedDisplayOrder), isActive: p.proposedIsActive, selectOptionsText: selectOptionsText(p.proposedSelectOptions) };
      setQuestions(questionState);
      setQuestionOrder(Object.keys(questionState).filter((key) => questionState[key].isActive).sort((a, b) => Number(questionState[a].displayOrder) - Number(questionState[b].displayOrder)));
    } catch (caught) { setError(errorMessage(caught)); } finally { if (showLoader) setLoading(false); }
  }
  useEffect(() => { void load(true); }, [draftId]);
  useEffect(() => { if (!notice) return; const timer = window.setTimeout(() => setNotice(''), 2800); return () => window.clearTimeout(timer); }, [notice]);

  const access = detail?.practiceLocation.currentRegularPracticeStaff;
  const availableSections = useMemo(() => [
    access?.canManageClinicDetails ? 'clinic' as const : null,
    access?.canManageServices || access?.canManageBookingQuestions ? 'content' as const : null,
    access?.canManageSchedules ? 'schedules' as const : null,
  ].filter((value): value is EditorSection => Boolean(value)), [access]);
  useEffect(() => { if (availableSections.length && !availableSections.includes(activeSection)) setActiveSection(availableSections[0]); }, [availableSections, activeSection]);

  async function run(key: string, action: () => Promise<unknown>, success: string) {
    if (working) return; setWorking(key); setError(''); setNotice('');
    try { await action(); await load(false); setNotice(success); } catch (caught) { setError(errorMessage(caught)); } finally { setWorking(''); }
  }
  const updateSchedule = (weekday: Weekday, patch: Partial<ScheduleForm>) => setSchedules((current) => current.map((row) => row.weekday === weekday ? { ...row, ...patch } : row));
  async function saveClinicDetails(event: FormEvent) { event.preventDefault(); if (!draftId) return; await run('clinic-details', () => apiRequest(`/secretary-settings-drafts/${encodeURIComponent(draftId)}/clinic-details`, { method: 'PUT', body: clinicDetails }), 'Clinic-details proposal saved.'); }
  async function saveSchedule(row: ScheduleForm) { if (!draftId) return; await run(`schedule:${row.weekday}`, () => apiRequest(`/secretary-settings-drafts/${encodeURIComponent(draftId)}/practice-schedule`, { method: 'PUT', body: { weekday: row.weekday, isOpen: row.isOpen, opensAtLocal: row.isOpen ? row.opensAtLocal || undefined : undefined, closesAtLocal: row.isOpen ? row.closesAtLocal || undefined : undefined, maximumOnlineBookingUntilLocal: row.isOpen ? row.maximumOnlineBookingUntilLocal || undefined : undefined, maximumOperatingUntilLocal: row.isOpen ? row.maximumOperatingUntilLocal || undefined : undefined } }), `${dayLabel(row.weekday)} proposal saved.`); }

  async function updateService(key: string, patch: Partial<ServiceForm>, success: string) {
    if (!draftId || working) return;
    const form = { ...services[key], ...patch }; const proposal = key.startsWith('proposal:'); const target = proposal ? `/services/proposals/${encodeURIComponent(key.slice(9))}` : `/services/effective/${encodeURIComponent(key)}`;
    setWorking(`service:${key}`); setError(''); setNotice('');
    try {
      const result = await apiRequest<ServiceMutationResult>(`/secretary-settings-drafts/${encodeURIComponent(draftId)}${target}`, { method: 'PUT', body: { name: form.name, durationMinutes: Number(form.durationMinutes), status: form.status, displayOrder: Number(form.displayOrder) } });
      setServices((current) => ({ ...current, [key]: form }));
      if (form.status === 'INACTIVE') setServiceOrder((current) => current.filter((item) => item !== key));
      recordProposal('service', result.proposalId); setNotice(success);
    } catch (caught) { setError(errorMessage(caught)); } finally { setWorking(''); }
  }

  async function createService(event: FormEvent) {
    event.preventDefault(); if (!draftId || working) return; const displayOrder = serviceOrder.length;
    setWorking('new-service'); setError(''); setNotice('');
    try {
      const result = await apiRequest<ServiceMutationResult>(`/secretary-settings-drafts/${encodeURIComponent(draftId)}/services`, { method: 'POST', body: { name: newService.name, durationMinutes: Number(newService.durationMinutes), status: 'ACTIVE', displayOrder } });
      const key = `proposal:${result.proposalId}`;
      const form: ServiceForm = { name: newService.name.trim(), durationMinutes: newService.durationMinutes, status: 'ACTIVE', displayOrder: String(result.proposedDisplayOrder ?? displayOrder) };
      setServices((current) => ({ ...current, [key]: form })); setServiceOrder((current) => [...current, key]);
      recordProposal('service', result.proposalId); setNewService({ name: '', durationMinutes: '15', status: 'ACTIVE', displayOrder: '0' }); setNotice('New service proposal added.');
    } catch (caught) { setError(errorMessage(caught)); } finally { setWorking(''); }
  }

  async function reorderServices(nextOrder: string[], fallbackOrder: string[]) {
    if (!draftId || working) return; setServiceOrder(nextOrder); setWorking('service-order'); setError(''); setNotice('');
    const nextServices = { ...services };
    nextOrder.forEach((key, index) => { if (nextServices[key]) nextServices[key] = { ...nextServices[key], displayOrder: String(index) }; });
    setServices(nextServices);
    try {
      for (let index = 0; index < nextOrder.length; index += 1) {
        const key = nextOrder[index]; const form = nextServices[key]; const proposal = key.startsWith('proposal:'); const target = proposal ? `/services/proposals/${encodeURIComponent(key.slice(9))}` : `/services/effective/${encodeURIComponent(key)}`;
        const result = await apiRequest<ServiceMutationResult>(`/secretary-settings-drafts/${encodeURIComponent(draftId)}${target}`, { method: 'PUT', body: { name: form.name, durationMinutes: Number(form.durationMinutes), status: form.status, displayOrder: index } });
        recordProposal('service', result.proposalId);
      }
      setNotice('Service display-order proposal saved.');
    } catch (caught) {
      setServiceOrder(fallbackOrder); const restored = { ...nextServices }; fallbackOrder.forEach((key, index) => { if (restored[key]) restored[key] = { ...restored[key], displayOrder: String(index) }; }); setServices(restored); setError(errorMessage(caught));
    } finally { setWorking(''); }
  }

  function questionPayload(form: QuestionForm, source?: QuestionRow | QuestionProposal) {
    const e = source && 'questionText' in source ? source : undefined; const p = source && 'proposedQuestionText' in source ? source : undefined;
    const enteredOptions = parsedSelectOptions(form.selectOptionsText);
    const fallbackOptions = selectOptions(p?.proposedSelectOptions ?? e?.selectOptions);
    const base = { questionText: form.questionText, helpText: form.helpText || undefined, type: form.type, isRequired: form.isRequired, displayOrder: Number(form.displayOrder), isActive: form.isActive };
    if (form.type === 'TEXT') return { ...base, textMaximumLength: p?.proposedTextMaximumLength ?? e?.textMaximumLength ?? undefined };
    if (form.type === 'NUMBER') return { ...base, numberMinimum: p?.proposedNumberMinimum ?? e?.numberMinimum ?? undefined, numberMaximum: p?.proposedNumberMaximum ?? e?.numberMaximum ?? undefined };
    if (form.type === 'SINGLE_SELECT') return { ...base, selectOptions: enteredOptions.length ? enteredOptions : fallbackOptions };
    return base;
  }

  async function updateQuestion(key: string, patch: Partial<QuestionForm>, success: string) {
    if (!draftId || !detail || working) return; const form = { ...questions[key], ...patch }; const proposal = key.startsWith('proposal:'); const id = proposal ? key.slice(9) : key;
    const source = proposal ? detail.proposedBookingQuestions.find((row) => row.id === id) : detail.practiceLocation.bookingQuestions.find((row) => row.id === id);
    const target = proposal ? `/booking-questions/proposals/${encodeURIComponent(id)}` : `/booking-questions/effective/${encodeURIComponent(id)}`;
    setWorking(`question:${key}`); setError(''); setNotice('');
    try {
      const result = await apiRequest<QuestionMutationResult>(`/secretary-settings-drafts/${encodeURIComponent(draftId)}${target}`, { method: 'PUT', body: questionPayload(form, source) });
      setQuestions((current) => ({ ...current, [key]: form }));
      if (!form.isActive) setQuestionOrder((current) => current.filter((item) => item !== key));
      recordProposal('question', result.proposalId); setNotice(success);
    } catch (caught) { setError(errorMessage(caught)); } finally { setWorking(''); }
  }

  async function createQuestion(event: FormEvent) {
    event.preventDefault(); if (!draftId || working) return;
    if (newQuestion.type === 'SINGLE_SELECT' && parsedSelectOptions(newQuestion.selectOptionsText).length < 2) { setError('Single select questions need at least two choices. Enter one choice per line.'); return; }
    const form = { ...newQuestion, questionText: newQuestion.questionText.trim(), displayOrder: String(questionOrder.length), isActive: true };
    setWorking('new-question'); setError(''); setNotice('');
    try {
      const result = await apiRequest<QuestionMutationResult>(`/secretary-settings-drafts/${encodeURIComponent(draftId)}/booking-questions`, { method: 'POST', body: questionPayload(form) });
      const key = `proposal:${result.proposalId}`;
      setQuestions((current) => ({ ...current, [key]: form })); setQuestionOrder((current) => [...current, key]);
      recordProposal('question', result.proposalId); setNewQuestion({ questionText: '', helpText: '', type: 'TEXT', isRequired: false, displayOrder: '0', isActive: true, selectOptionsText: '' }); setNotice('New booking-question proposal added.');
    } catch (caught) { setError(errorMessage(caught)); } finally { setWorking(''); }
  }

  async function reorderQuestions(nextOrder: string[], fallbackOrder: string[]) {
    if (!draftId || !detail || working) return; setQuestionOrder(nextOrder); setWorking('question-order'); setError(''); setNotice('');
    const nextQuestions = { ...questions };
    nextOrder.forEach((key, index) => { if (nextQuestions[key]) nextQuestions[key] = { ...nextQuestions[key], displayOrder: String(index) }; });
    setQuestions(nextQuestions);
    try {
      for (let index = 0; index < nextOrder.length; index += 1) {
        const key = nextOrder[index]; const form = nextQuestions[key]; const proposal = key.startsWith('proposal:'); const id = proposal ? key.slice(9) : key;
        const source = proposal ? detail.proposedBookingQuestions.find((row) => row.id === id) : detail.practiceLocation.bookingQuestions.find((row) => row.id === id);
        const target = proposal ? `/booking-questions/proposals/${encodeURIComponent(id)}` : `/booking-questions/effective/${encodeURIComponent(id)}`;
        const result = await apiRequest<QuestionMutationResult>(`/secretary-settings-drafts/${encodeURIComponent(draftId)}${target}`, { method: 'PUT', body: questionPayload(form, source) });
        recordProposal('question', result.proposalId);
      }
      setNotice('Booking-question order proposal saved.');
    } catch (caught) {
      setQuestionOrder(fallbackOrder); const restored = { ...nextQuestions }; fallbackOrder.forEach((key, index) => { if (restored[key]) restored[key] = { ...restored[key], displayOrder: String(index) }; }); setQuestions(restored); setError(errorMessage(caught));
    } finally { setWorking(''); }
  }

  function startServiceDrag(event: DragEvent, key: string) { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', key); setDraggedService(key); setServiceDragOrigin(serviceOrder); }
  function startQuestionDrag(event: DragEvent, key: string) { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', key); setDraggedQuestion(key); setQuestionDragOrigin(questionOrder); }
  function previewService(targetKey: string) { if (draggedService) setServiceOrder((current) => moveKey(current, draggedService, targetKey)); }
  function previewQuestion(targetKey: string) { if (draggedQuestion) setQuestionOrder((current) => moveKey(current, draggedQuestion, targetKey)); }
  function finishServiceDrag() { if (!draggedService) return; const next = serviceOrder; const origin = serviceDragOrigin; const changed = next.join('|') !== origin.join('|'); setDraggedService(''); setServiceDragOrigin([]); if (changed) void reorderServices(next, origin); }
  function finishQuestionDrag() { if (!draggedQuestion) return; const next = questionOrder; const origin = questionDragOrigin; const changed = next.join('|') !== origin.join('|'); setDraggedQuestion(''); setQuestionDragOrigin([]); if (changed) void reorderQuestions(next, origin); }

  async function saveException(event: FormEvent) { event.preventDefault(); if (!draftId) return; await run('exception', () => apiRequest(`/secretary-settings-drafts/${encodeURIComponent(draftId)}/schedule-exception`, { method: 'PUT', body: { serviceDate: exception.serviceDate, isOpen: exception.isOpen, opensAtLocal: exception.isOpen ? exception.opensAtLocal || undefined : undefined, closesAtLocal: exception.isOpen ? exception.closesAtLocal || undefined : undefined, maximumOnlineBookingUntilLocal: exception.isOpen ? exception.maximumOnlineBookingUntilLocal || undefined : undefined, maximumOperatingUntilLocal: exception.isOpen ? exception.maximumOperatingUntilLocal || undefined : undefined } }), 'Date-specific schedule proposal saved.'); }
  async function submit() { if (!draftId) return; await run('submit', () => apiRequest(`/secretary-settings-drafts/${encodeURIComponent(draftId)}/submit`, { method: 'POST' }), 'Draft submitted to the Doctor for review.'); }

  if (loading) return <section className="practice-admin-page"><p className="practice-muted">Loading settings draft…</p></section>;
  if (!detail) return <section className="practice-admin-page"><div className="form-error" role="alert">{error || 'Settings draft was not found.'}</div><Link to="/app/secretary/clinics">Clinics</Link></section>;

  const clinicName = detail.practiceLocation.name?.trim() || 'Clinic settings';
  const proposalCount = (detail.proposedClinicDetails ? 1 : 0) + detail.proposedPracticeSchedules.length + detail.proposedServices.length + detail.proposedBookingQuestions.length + detail.proposedScheduleExceptions.length + proposalCountDelta;
  const sectionLabels: Record<EditorSection, string> = { clinic: 'Clinic details', content: 'Services & questions', schedules: 'Clinic schedules' };
  const hasEffectiveService = (key: string) => !key.startsWith('proposal:');
  const hasEffectiveQuestion = (key: string) => !key.startsWith('proposal:');

  const servicesPanel = access?.canManageServices ? <section className="secretary-content-panel approved-content-panel" aria-labelledby="secretary-services-heading">
    <div className="practice-panel-heading"><div><p className="eyebrow">Services</p><h2 id="secretary-services-heading">Clinic services</h2><p>Propose changes to this clinic's services or add a new service.<br />Changes take effect only after Doctor approval.</p></div></div>
    <div className="proposal-sort-list" aria-label="Clinic services">
      {serviceOrder.map((key, index) => { const form = services[key]; if (!form) return null; return <div className="proposal-sort-row" key={key} draggable={editable && !working} onDragStart={(event) => startServiceDrag(event, key)} onDragEnter={() => previewService(key)} onDragOver={(event) => event.preventDefault()} onDragEnd={finishServiceDrag}>
        <DragHandle /><span className="proposal-order">{index + 1}.</span><div className="proposal-row-copy"><strong>{form.name}</strong><span>{form.durationMinutes} minutes</span></div><span className={hasEffectiveService(key) ? 'proposal-badge active' : 'proposal-badge draft'}>{hasEffectiveService(key) ? 'Active' : 'Draft'}</span>
        {editable ? <button className="proposal-trash" type="button" aria-label={`Remove ${form.name}`} disabled={working === `service:${key}`} onClick={() => void updateService(key, { status: 'INACTIVE' }, 'Service removal proposal saved.')}><TrashIcon /></button> : null}
      </div>; })}
    </div>
    {editable ? <form className="practice-form compact-form proposal-add-form" onSubmit={createService}><label>Service name<input required placeholder="Enter service name" value={newService.name} onChange={(e) => setNewService({ ...newService, name: e.target.value })} /></label><label>Expected duration (minutes)<input required type="number" min="1" placeholder="e.g., 15" value={newService.durationMinutes} onChange={(e) => setNewService({ ...newService, durationMinutes: e.target.value })} /></label><button className="proposal-add-button" disabled={working === 'new-service'}>{working === 'new-service' ? 'Adding…' : 'Add service proposal'}</button></form> : null}
    <div className="proposal-legend"><span><span className="proposal-badge active">Active</span> Currently used in this clinic</span><span><span className="proposal-badge draft">Draft</span> Proposed change (not yet approved)</span></div>
  </section> : null;

  const questionsPanel = access?.canManageBookingQuestions ? <section className="secretary-content-panel approved-content-panel" aria-labelledby="secretary-questions-heading">
    <div className="practice-panel-heading"><div><p className="eyebrow">Booking questions</p><h2 id="secretary-questions-heading">Patient booking questions</h2><p>Propose the questions patients answer when booking this clinic.<br />Changes take effect only after Doctor approval.</p></div></div>
    <div className="proposal-sort-list" aria-label="Patient booking questions">
      {questionOrder.map((key, index) => { const form = questions[key]; if (!form) return null; return <div className="proposal-sort-row" key={key} draggable={editable && !working} onDragStart={(event) => startQuestionDrag(event, key)} onDragEnter={() => previewQuestion(key)} onDragOver={(event) => event.preventDefault()} onDragEnd={finishQuestionDrag}>
        <DragHandle /><span className="proposal-order">{index + 1}.</span><div className="proposal-row-copy"><strong>{form.questionText}</strong><span>{questionTypeLabel(form.type)} · {form.isRequired ? 'Required' : 'Optional'}</span></div><span className={hasEffectiveQuestion(key) ? 'proposal-badge active' : 'proposal-badge draft'}>{hasEffectiveQuestion(key) ? 'Active' : 'Draft'}</span>
        {editable ? <button className="proposal-trash" type="button" aria-label={`Remove ${form.questionText}`} disabled={working === `question:${key}`} onClick={() => void updateQuestion(key, { isActive: false }, 'Booking-question removal proposal saved.')}><TrashIcon /></button> : null}
      </div>; })}
    </div>
    {editable ? <form className="practice-form compact-form proposal-add-form" onSubmit={createQuestion}>
      <label>Question<input required placeholder="Enter your question" value={newQuestion.questionText} onChange={(e) => setNewQuestion({ ...newQuestion, questionText: e.target.value })} /></label>
      <label>Answer type<select value={newQuestion.type} onChange={(e) => setNewQuestion({ ...newQuestion, type: e.target.value as QuestionType, selectOptionsText: e.target.value === 'SINGLE_SELECT' ? newQuestion.selectOptionsText : '' })}><option value="TEXT">Text</option><option value="NUMBER">Number</option><option value="BOOLEAN">Yes / No</option><option value="SINGLE_SELECT">Single select</option></select></label>
      <label className="proposal-checkbox"><input type="checkbox" checked={newQuestion.isRequired} onChange={(e) => setNewQuestion({ ...newQuestion, isRequired: e.target.checked })} /> Required before booking can continue</label>
      {newQuestion.type === 'SINGLE_SELECT' ? <label>Choices <span className="optional">One per line</span><textarea required rows={4} placeholder={'Option 1\nOption 2'} value={newQuestion.selectOptionsText} onChange={(e) => setNewQuestion({ ...newQuestion, selectOptionsText: e.target.value })} /></label> : null}
      <button className="proposal-add-button" disabled={working === 'new-question'}>{working === 'new-question' ? 'Adding…' : 'Add question proposal'}</button>
    </form> : null}
    <div className="proposal-legend"><span><span className="proposal-badge active">Active</span> Currently used in this clinic</span><span><span className="proposal-badge draft">Draft</span> Proposed change (not yet approved)</span></div>
  </section> : null;

  return <section className="secretary-proposal-page" aria-labelledby="secretary-draft-heading">
    <Link className="secretary-back-link" to="/app/secretary/clinics">← Back to clinics</Link>
    <div className="secretary-proposal-header">
      <div><p className="eyebrow">Secretary settings proposal</p><div className="secretary-proposal-title-row"><h1 id="secretary-draft-heading">{clinicName}</h1><span className="practice-status">{statusLabel(detail.status)}</span></div><p className="practice-muted">Prepare proposed clinic changes for Doctor review. Nothing on this page becomes effective until the Doctor approves the draft.</p></div>
      <div className="secretary-proposal-actions"><Link className="secondary-action" to="/app/secretary/clinics">Cancel</Link>{editable ? <button className="primary" type="button" disabled={working === 'submit' || proposalCount === 0} onClick={() => void submit()}>{working === 'submit' ? 'Submitting…' : 'Submit to Doctor'}</button> : null}</div>
    </div>
    {detail.reviewComment ? <div className="practice-notice"><strong>Doctor note:</strong> {detail.reviewComment}</div> : null}
    {detail.status === 'SUBMITTED' ? <div className="practice-notice">Waiting for Doctor review. The Secretary cannot edit or withdraw this submitted draft.</div> : null}
    {detail.status === 'APPROVED' ? <div className="practice-notice practice-success">This draft was approved and is closed.</div> : null}
    {detail.status === 'REJECTED' ? <div className="practice-notice">This draft was rejected and is permanently closed.</div> : null}
    {detail.status === 'RETURNED_FOR_REWORK' ? <div className="practice-notice">The Doctor returned this same draft for rework. Revise it and submit again when ready.</div> : null}
    {error ? <div className="secretary-action-toast error" role="alert"><span className="secretary-toast-icon">!</span><span>{error}</span><button type="button" aria-label="Dismiss message" onClick={() => setError('')}>×</button></div> : null}
    {notice ? <div className="secretary-action-toast success" role="status"><span className="secretary-toast-icon">✓</span><span>{notice}</span><button type="button" aria-label="Dismiss message" onClick={() => setNotice('')}>×</button></div> : null}

    <div className="secretary-proposal-layout">
      <nav className="secretary-proposal-nav" aria-label="Proposal sections">{availableSections.map((section) => <button key={section} type="button" className={activeSection === section ? 'active' : ''} onClick={() => setActiveSection(section)}>{sectionLabels[section]}</button>)}</nav>
      <div className="secretary-proposal-content">
        {activeSection === 'clinic' && access?.canManageClinicDetails ? <section className="secretary-proposal-panel"><div className="practice-panel-heading"><div><h2>Identity, address & contact</h2><p>These fields remain unchanged for patients and staff until the Doctor approves this draft.</p></div></div><form className="practice-form" onSubmit={saveClinicDetails}><div className="practice-form-grid"><label>Clinic name<input required disabled={!editable} value={clinicDetails.name} onChange={(e) => setClinicDetails({ ...clinicDetails, name: e.target.value })} /></label><label>Contact number<input required disabled={!editable} value={clinicDetails.contactNumber} onChange={(e) => setClinicDetails({ ...clinicDetails, contactNumber: e.target.value })} /></label><label>Address line 1<input required disabled={!editable} value={clinicDetails.addressLine1} onChange={(e) => setClinicDetails({ ...clinicDetails, addressLine1: e.target.value })} /></label><label>Address line 2 <span className="optional">Optional</span><input disabled={!editable} value={clinicDetails.addressLine2} onChange={(e) => setClinicDetails({ ...clinicDetails, addressLine2: e.target.value })} /></label><label>City / municipality<input required disabled={!editable} value={clinicDetails.cityMunicipality} onChange={(e) => setClinicDetails({ ...clinicDetails, cityMunicipality: e.target.value })} /></label><label>Province<input required disabled={!editable} value={clinicDetails.province} onChange={(e) => setClinicDetails({ ...clinicDetails, province: e.target.value })} /></label><label>Postal code <span className="optional">Optional</span><input disabled={!editable} value={clinicDetails.postalCode} onChange={(e) => setClinicDetails({ ...clinicDetails, postalCode: e.target.value })} /></label><label>Country code<input required maxLength={2} disabled={!editable} value={clinicDetails.countryCode} onChange={(e) => setClinicDetails({ ...clinicDetails, countryCode: e.target.value.toUpperCase() })} /></label><label>Time zone<input required disabled={!editable} value={clinicDetails.timeZone} onChange={(e) => setClinicDetails({ ...clinicDetails, timeZone: e.target.value })} /></label></div>{editable ? <button className="secondary" disabled={Boolean(working)}>{working === 'clinic-details' ? 'Saving…' : 'Save clinic details'}</button> : null}</form></section> : null}
        {activeSection === 'content' ? <section className="secretary-proposal-panel secretary-content-section"><div className="secretary-content-grid">{servicesPanel}{questionsPanel}</div></section> : null}
        {activeSection === 'schedules' && access?.canManageSchedules ? <section className="secretary-proposal-panel"><div className="practice-panel-heading"><div><h2>Clinic schedules</h2><p>Recurring hours and date-specific exceptions are proposed here. Final conflict validation happens at Doctor approval.</p></div></div><div className="secretary-schedule-list">{schedules.map((row) => <div className="secretary-schedule-row" key={row.weekday}><div className="stack"><label><input type="checkbox" disabled={!editable} checked={row.isOpen} onChange={(e) => updateSchedule(row.weekday, { isOpen: e.target.checked })} /> {dayLabel(row.weekday)} open</label>{row.isOpen ? <div className="practice-form-grid"><label>Opens<input type="time" disabled={!editable} value={row.opensAtLocal} onChange={(e) => updateSchedule(row.weekday, { opensAtLocal: e.target.value })} /></label><label>Closes<input type="time" disabled={!editable} value={row.closesAtLocal} onChange={(e) => updateSchedule(row.weekday, { closesAtLocal: e.target.value })} /></label><label>Online cutoff <span className="optional">Optional</span><input type="time" disabled={!editable} value={row.maximumOnlineBookingUntilLocal} onChange={(e) => updateSchedule(row.weekday, { maximumOnlineBookingUntilLocal: e.target.value })} /></label><label>Maximum operating until <span className="optional">Optional</span><input type="time" disabled={!editable} value={row.maximumOperatingUntilLocal} onChange={(e) => updateSchedule(row.weekday, { maximumOperatingUntilLocal: e.target.value })} /></label></div> : null}</div>{editable ? <button className="secondary" type="button" disabled={Boolean(working)} onClick={() => void saveSchedule(row)}>{working === `schedule:${row.weekday}` ? 'Saving…' : 'Save day'}</button> : null}</div>)}</div><div className="secretary-proposal-add"><h3>Date-specific exception</h3>{detail.proposedScheduleExceptions.length ? <div className="practice-location-meta">{detail.proposedScheduleExceptions.map((row) => <span key={row.id}>{dateOnly(row.serviceDate)} · {row.proposedIsOpen ? `${timeOnly(row.proposedOpensAtLocal)}–${timeOnly(row.proposedClosesAtLocal)}` : 'Closed'}</span>)}</div> : <p className="practice-muted">No date-specific proposals yet.</p>}{editable ? <form className="practice-form" onSubmit={saveException}><div className="practice-form-grid"><label>Date<input required type="date" value={exception.serviceDate} onChange={(e) => setException({ ...exception, serviceDate: e.target.value })} /></label><label><input type="checkbox" checked={exception.isOpen} onChange={(e) => setException({ ...exception, isOpen: e.target.checked })} /> Clinic open on this date</label></div>{exception.isOpen ? <div className="practice-form-grid"><label>Opens<input required type="time" value={exception.opensAtLocal} onChange={(e) => setException({ ...exception, opensAtLocal: e.target.value })} /></label><label>Closes<input required type="time" value={exception.closesAtLocal} onChange={(e) => setException({ ...exception, closesAtLocal: e.target.value })} /></label><label>Online cutoff <span className="optional">Optional</span><input type="time" value={exception.maximumOnlineBookingUntilLocal} onChange={(e) => setException({ ...exception, maximumOnlineBookingUntilLocal: e.target.value })} /></label><label>Maximum operating until <span className="optional">Optional</span><input type="time" value={exception.maximumOperatingUntilLocal} onChange={(e) => setException({ ...exception, maximumOperatingUntilLocal: e.target.value })} /></label></div> : null}<button className="secondary" disabled={Boolean(working)}>Save date exception</button></form> : null}</div></section> : null}
      </div>
      <aside className="secretary-proposal-summary"><h2>Draft summary</h2><p className="practice-muted">Only submitted proposals are reviewed by the Doctor.</p><dl><div><dt>Status</dt><dd>{statusLabel(detail.status)}</dd></div><div><dt>Saved proposals</dt><dd>{proposalCount}</dd></div><div><dt>Current section</dt><dd>{sectionLabels[activeSection]}</dd></div></dl>{editable ? <p className="practice-muted">Save changes within each section, then submit the draft when it is ready for review.</p> : null}</aside>
    </div>
  </section>;
}
