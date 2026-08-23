import { FormEvent, useEffect, useMemo, useState } from 'react';
import { ApiError, apiRequest } from '../api/client';

type ServiceTemplate = {
  id: string;
  name: string;
  durationMinutes: number;
  status: 'ACTIVE' | 'INACTIVE';
};

type BookingQuestionTemplate = {
  id: string;
  questionText: string;
  helpText: string | null;
  type: 'TEXT' | 'NUMBER' | 'BOOLEAN' | 'SINGLE_SELECT';
  isRequired: boolean;
  displayOrder: number;
  isActive: boolean;
};

type DefaultsResponse = {
  services: ServiceTemplate[];
  bookingQuestions: BookingQuestionTemplate[];
};

type PracticeLocation = {
  id: string;
  lifecycleStatus: string;
  name: string | null;
  addressLine1: string | null;
  cityMunicipality: string | null;
};

function errorMessage(error: unknown) {
  return error instanceof ApiError ? error.message : 'Unable to complete this action. Please try again.';
}

function locationName(location: PracticeLocation) {
  return location.name?.trim() || location.addressLine1?.trim() || location.cityMunicipality?.trim() || 'Untitled practice location';
}

export function DoctorDefaultsPage() {
  const [defaults, setDefaults] = useState<DefaultsResponse>({ services: [], bookingQuestions: [] });
  const [locations, setLocations] = useState<PracticeLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [savingService, setSavingService] = useState(false);
  const [savingQuestion, setSavingQuestion] = useState(false);
  const [applying, setApplying] = useState(false);
  const [selectedLocations, setSelectedLocations] = useState<string[]>([]);

  const [serviceName, setServiceName] = useState('');
  const [serviceDuration, setServiceDuration] = useState('30');
  const [questionText, setQuestionText] = useState('');
  const [questionType, setQuestionType] = useState<BookingQuestionTemplate['type']>('TEXT');
  const [questionRequired, setQuestionRequired] = useState(false);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const [defaultsResponse, locationResponse] = await Promise.all([
        apiRequest<DefaultsResponse>('/doctor/defaults'),
        apiRequest<PracticeLocation[]>('/practice-location'),
      ]);
      setDefaults(defaultsResponse);
      setLocations(locationResponse.filter((location) => location.lifecycleStatus !== 'PERMANENTLY_DELETED'));
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  const nextDisplayOrder = useMemo(() => {
    if (!defaults.bookingQuestions.length) return 0;
    return Math.max(...defaults.bookingQuestions.map((question) => question.displayOrder)) + 1;
  }, [defaults.bookingQuestions]);

  async function addService(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSavingService(true);
    setError('');
    setNotice('');
    try {
      await apiRequest('/doctor/defaults/services', {
        method: 'POST',
        body: {
          name: serviceName,
          durationMinutes: Number(serviceDuration),
          status: 'ACTIVE',
        },
      });
      setServiceName('');
      setServiceDuration('30');
      setNotice('Service default saved. Existing locations are unchanged until you apply defaults.');
      await load();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSavingService(false);
    }
  }

  async function addQuestion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSavingQuestion(true);
    setError('');
    setNotice('');
    try {
      await apiRequest('/doctor/defaults/booking-questions', {
        method: 'POST',
        body: {
          questionText,
          type: questionType,
          isRequired: questionRequired,
          displayOrder: nextDisplayOrder,
          isActive: true,
          ...(questionType === 'TEXT' ? { textMaximumLength: 500 } : {}),
          ...(questionType === 'SINGLE_SELECT' ? { selectOptions: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }] } : {}),
        },
      });
      setQuestionText('');
      setQuestionType('TEXT');
      setQuestionRequired(false);
      setNotice('Booking question default saved. Existing locations are unchanged until you apply defaults.');
      await load();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSavingQuestion(false);
    }
  }

  function toggleLocation(locationId: string) {
    setSelectedLocations((current) => current.includes(locationId)
      ? current.filter((id) => id !== locationId)
      : [...current, locationId]);
  }

  async function applyDefaults() {
    if (!selectedLocations.length) return;
    setApplying(true);
    setError('');
    setNotice('');
    try {
      await apiRequest('/doctor/defaults/apply', {
        method: 'POST',
        headers: { 'Idempotency-Key': crypto.randomUUID() },
        body: { practiceLocationIds: selectedLocations },
      });
      setSelectedLocations([]);
      setNotice('Current Doctor-wide defaults applied to the selected practice locations.');
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setApplying(false);
    }
  }

  return (
    <section className="practice-admin-page" aria-labelledby="doctor-defaults-heading">
      <div className="practice-admin-heading">
        <div>
          <p className="eyebrow">Doctor-wide defaults</p>
          <h1 id="doctor-defaults-heading">Defaults for new clinics</h1>
          <p>Services and booking questions here are templates. New practice locations copy them automatically; existing locations change only when you explicitly apply the current defaults.</p>
        </div>
      </div>

      {error ? <div className="form-error" role="alert">{error}</div> : null}
      {notice ? <div className="practice-notice" role="status">{notice}</div> : null}
      {loading ? <p className="practice-muted">Loading defaults…</p> : null}

      {!loading ? (
        <div className="defaults-grid">
          <section className="practice-create-panel" aria-labelledby="service-defaults-heading">
            <div className="practice-panel-heading">
              <p className="eyebrow">Services</p>
              <h2 id="service-defaults-heading">Service defaults</h2>
              <p>Each service needs a name and expected duration. Duration is used as workload information and may be adjusted later per clinic.</p>
            </div>
            <div className="defaults-list">
              {defaults.services.length ? defaults.services.map((service) => (
                <div className="default-row" key={service.id}>
                  <div><strong>{service.name}</strong><span>{service.durationMinutes} minutes</span></div>
                  <span className="practice-status">{service.status}</span>
                </div>
              )) : <p className="practice-muted">No Service defaults yet.</p>}
            </div>
            <form className="practice-form compact-form" onSubmit={addService}>
              <label>Service name<input required maxLength={150} value={serviceName} onChange={(event) => setServiceName(event.target.value)} /></label>
              <label>Expected duration (minutes)<input required type="number" min={1} max={1440} value={serviceDuration} onChange={(event) => setServiceDuration(event.target.value)} /></label>
              <button className="primary" type="submit" disabled={savingService || !serviceName.trim()}>{savingService ? 'Saving…' : 'Add service default'}</button>
            </form>
          </section>

          <section className="practice-create-panel" aria-labelledby="question-defaults-heading">
            <div className="practice-panel-heading">
              <p className="eyebrow">Booking questions</p>
              <h2 id="question-defaults-heading">Question defaults</h2>
              <p>Up to five active questions can be used as the Doctor-wide default set. Each clinic receives its own copy.</p>
            </div>
            <div className="defaults-list">
              {defaults.bookingQuestions.length ? defaults.bookingQuestions.map((question) => (
                <div className="default-row" key={question.id}>
                  <div><strong>{question.questionText}</strong><span>{question.type.replace('_', ' ')} · {question.isRequired ? 'Required' : 'Optional'}</span></div>
                  <span className="practice-status">{question.isActive ? 'ACTIVE' : 'INACTIVE'}</span>
                </div>
              )) : <p className="practice-muted">No BookingQuestion defaults yet.</p>}
            </div>
            <form className="practice-form compact-form" onSubmit={addQuestion}>
              <label>Question<input required maxLength={500} value={questionText} onChange={(event) => setQuestionText(event.target.value)} /></label>
              <label>Answer type<select value={questionType} onChange={(event) => setQuestionType(event.target.value as BookingQuestionTemplate['type'])}><option value="TEXT">Text</option><option value="NUMBER">Number</option><option value="BOOLEAN">Yes / No</option><option value="SINGLE_SELECT">Single select</option></select></label>
              <label className="inline-check"><input type="checkbox" checked={questionRequired} onChange={(event) => setQuestionRequired(event.target.checked)} /> Required before booking can continue</label>
              <button className="primary" type="submit" disabled={savingQuestion || !questionText.trim()}>{savingQuestion ? 'Saving…' : 'Add question default'}</button>
            </form>
          </section>
        </div>
      ) : null}

      {!loading ? (
        <section className="practice-create-panel" aria-labelledby="apply-defaults-heading">
          <div className="practice-panel-heading">
            <p className="eyebrow">Explicit apply</p>
            <h2 id="apply-defaults-heading">Apply current defaults to existing clinics</h2>
            <p>This copies the current template meaning into the selected practice locations. Later edits here will not silently change those clinics.</p>
          </div>
          {locations.length ? (
            <div className="location-selection-list">
              {locations.map((location) => (
                <label className="location-selection-row" key={location.id}>
                  <input type="checkbox" checked={selectedLocations.includes(location.id)} onChange={() => toggleLocation(location.id)} />
                  <span><strong>{locationName(location)}</strong><small>{location.lifecycleStatus.replaceAll('_', ' ')}</small></span>
                </label>
              ))}
            </div>
          ) : <p className="practice-muted">Create a practice location before applying defaults.</p>}
          <button className="primary" type="button" disabled={applying || !selectedLocations.length} onClick={() => void applyDefaults()}>{applying ? 'Applying…' : `Apply to ${selectedLocations.length || 0} selected`}</button>
        </section>
      ) : null}
    </section>
  );
}
