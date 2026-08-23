import { FormEvent, useEffect, useState } from 'react';
import { ApiError, apiRequest } from '../api/client';

type PracticeLocation = {
  id: string;
  publicIdentifier: string;
  lifecycleStatus: string;
  name: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  cityMunicipality: string | null;
  province: string | null;
  postalCode: string | null;
  contactNumber: string | null;
  countryCode: string;
  timeZone: string;
  isBookingEnabled: boolean;
  currentRegularPracticeStaffId: string | null;
  createdAt: string;
  updatedAt: string;
};

type LocationDraft = {
  name: string;
  addressLine1: string;
  addressLine2: string;
  cityMunicipality: string;
  province: string;
  postalCode: string;
  contactNumber: string;
};

const emptyDraft: LocationDraft = {
  name: '',
  addressLine1: '',
  addressLine2: '',
  cityMunicipality: '',
  province: '',
  postalCode: '',
  contactNumber: '',
};

function locationTitle(location: PracticeLocation) {
  return location.name?.trim() || 'Untitled practice location';
}

function addressSummary(location: PracticeLocation) {
  const parts = [location.addressLine1, location.addressLine2, location.cityMunicipality, location.province, location.postalCode]
    .map((value) => value?.trim())
    .filter(Boolean);
  return parts.length ? parts.join(', ') : 'Address not configured yet';
}

function messageFrom(error: unknown) {
  return error instanceof ApiError ? error.message : 'Unable to complete this action. Please try again.';
}

export function PracticeLocationsPage() {
  const [locations, setLocations] = useState<PracticeLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [draft, setDraft] = useState<LocationDraft>(emptyDraft);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  async function loadLocations() {
    setLoading(true);
    setError('');
    try {
      setLocations(await apiRequest<PracticeLocation[]>('/practice-location'));
    } catch (caught) {
      setError(messageFrom(caught));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void loadLocations(); }, []);

  function updateDraft(field: keyof LocationDraft, value: string) {
    setDraft((current) => ({ ...current, [field]: value }));
  }

  async function createLocation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      await apiRequest('/practice-location', { method: 'POST', body: draft });
      setDraft(emptyDraft);
      setShowCreate(false);
      await loadLocations();
    } catch (caught) {
      setError(messageFrom(caught));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="practice-admin-page" aria-labelledby="practice-locations-heading">
      <div className="practice-admin-heading">
        <div>
          <p className="eyebrow">Practice administration</p>
          <h1 id="practice-locations-heading">Practice locations</h1>
          <p>Each clinic location has its own services, questions, schedule, staff, queue operations, and public booking route.</p>
        </div>
        <button className="primary" type="button" onClick={() => setShowCreate(true)}>Create practice location</button>
      </div>

      {error ? <div className="form-error" role="alert">{error}</div> : null}

      {showCreate ? (
        <section className="practice-create-panel" aria-labelledby="create-location-heading">
          <div className="practice-panel-heading">
            <div>
              <p className="eyebrow">New location</p>
              <h2 id="create-location-heading">Start as a draft</h2>
              <p>You can save a blank or partially configured location now and finish the operational setup before activation.</p>
            </div>
          </div>
          <form className="practice-form" onSubmit={createLocation}>
            <label>Location name<input value={draft.name} onChange={(event) => updateDraft('name', event.target.value)} maxLength={200} /></label>
            <label>Address line 1<input value={draft.addressLine1} onChange={(event) => updateDraft('addressLine1', event.target.value)} maxLength={255} /></label>
            <label>Address line 2<input value={draft.addressLine2} onChange={(event) => updateDraft('addressLine2', event.target.value)} maxLength={255} /></label>
            <div className="practice-form-grid">
              <label>City / municipality<input value={draft.cityMunicipality} onChange={(event) => updateDraft('cityMunicipality', event.target.value)} maxLength={120} /></label>
              <label>Province<input value={draft.province} onChange={(event) => updateDraft('province', event.target.value)} maxLength={120} /></label>
            </div>
            <div className="practice-form-grid">
              <label>Postal code<input value={draft.postalCode} onChange={(event) => updateDraft('postalCode', event.target.value)} maxLength={20} /></label>
              <label>Contact number<input value={draft.contactNumber} onChange={(event) => updateDraft('contactNumber', event.target.value)} maxLength={30} /></label>
            </div>
            <div className="button-row">
              <button className="primary" type="submit" disabled={submitting}>{submitting ? 'Saving…' : 'Save draft location'}</button>
              <button className="secondary" type="button" disabled={submitting} onClick={() => { setShowCreate(false); setDraft(emptyDraft); setError(''); }}>Cancel</button>
            </div>
          </form>
        </section>
      ) : null}

      <section className="practice-list" aria-label="Practice locations">
        {loading ? <p className="practice-muted">Loading practice locations…</p> : null}
        {!loading && locations.length === 0 ? (
          <div className="practice-empty">
            <h2>No practice locations yet</h2>
            <p>Create the first location as a draft. Activation comes later, after the required configuration is complete.</p>
          </div>
        ) : null}
        {locations.map((location) => (
          <article className="practice-location-card" key={location.id}>
            <div>
              <div className="practice-location-title-row">
                <h2>{locationTitle(location)}</h2>
                <span className="practice-status">{location.lifecycleStatus.replaceAll('_', ' ')}</span>
              </div>
              <p>{addressSummary(location)}</p>
              <div className="practice-location-meta">
                <span>{location.timeZone}</span>
                <span>{location.contactNumber || 'No contact number'}</span>
                <span>{location.isBookingEnabled ? 'Booking enabled' : 'Booking not enabled'}</span>
              </div>
            </div>
            <div className="practice-card-actions">
              <button className="secondary" type="button" disabled>Configure</button>
            </div>
          </article>
        ))}
      </section>
    </section>
  );
}
