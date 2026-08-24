import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiError, apiRequest } from '../api/client';

type DraftSummary = {
  id: string;
  status: 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'RETURNED_FOR_REWORK';
  submittedAt: string | null;
  reviewedAt: string | null;
  reviewComment: string | null;
  createdAt: string;
  updatedAt: string;
};

type AssignedClinic = {
  id: string;
  lifecycleStatus: string;
  name: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  cityMunicipality: string | null;
  province: string | null;
  postalCode: string | null;
  contactNumber: string | null;
  timeZone: string | null;
  isBookingEnabled: boolean;
  latestSettingsDraft: DraftSummary | null;
  settingsDrafts: DraftSummary[];
};

function clinicName(clinic: AssignedClinic) {
  return clinic.name?.trim() || 'Untitled clinic location';
}

function clinicAddress(clinic: AssignedClinic) {
  const parts = [clinic.addressLine1, clinic.addressLine2, clinic.cityMunicipality, clinic.province, clinic.postalCode]
    .map((value) => value?.trim())
    .filter(Boolean);
  return parts.length ? parts.join(', ') : 'Address not configured';
}

function draftStatusLabel(status: DraftSummary['status']) {
  if (status === 'RETURNED_FOR_REWORK') return 'Returned for rework';
  return status.charAt(0) + status.slice(1).toLowerCase();
}

function messageFrom(error: unknown) {
  return error instanceof ApiError ? error.message : 'Unable to load assigned clinics. Please try again.';
}

export function SecretaryClinicsPage() {
  const navigate = useNavigate();
  const [clinics, setClinics] = useState<AssignedClinic[]>([]);
  const [loading, setLoading] = useState(true);
  const [workingClinicId, setWorkingClinicId] = useState('');
  const [error, setError] = useState('');

  async function load() {
    setLoading(true);
    setError('');
    try {
      setClinics(await apiRequest<AssignedClinic[]>('/secretary-workspace/clinics'));
    } catch (caught) {
      setError(messageFrom(caught));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  async function startOrContinueDraft(clinic: AssignedClinic) {
    setWorkingClinicId(clinic.id);
    setError('');
    try {
      const draft = await apiRequest<{ id: string; status: DraftSummary['status']; reused: boolean }>('/secretary-settings-drafts', {
        method: 'POST',
        body: { practiceLocationId: clinic.id },
      });
      navigate(`/app/secretary/settings-drafts/${encodeURIComponent(draft.id)}`);
    } catch (caught) {
      setError(messageFrom(caught));
      setWorkingClinicId('');
    }
  }

  function openDraft(draft: DraftSummary) {
    navigate(`/app/secretary/settings-drafts/${encodeURIComponent(draft.id)}`);
  }

  return (
    <section className="practice-admin-page" aria-labelledby="secretary-clinics-heading">
      <div className="practice-admin-heading">
        <div>
          <p className="eyebrow">Secretary workspace</p>
          <h1 id="secretary-clinics-heading">Assigned clinics</h1>
          <p>Only clinics where you are the current regular Secretary appear here. Settings changes remain proposals until the Doctor approves them.</p>
        </div>
      </div>

      {error ? <div className="form-error" role="alert">{error}</div> : null}
      {loading ? <p className="practice-muted">Loading assigned clinics…</p> : null}

      {!loading && clinics.length === 0 ? (
        <div className="practice-empty">
          <h2>No assigned clinics</h2>
          <p>You currently have no regular Secretary assignment. If a Doctor assigns or replaces clinic staff, this workspace updates from the current assignment state.</p>
        </div>
      ) : null}

      <section className="practice-list" aria-label="Assigned clinics">
        {clinics.map((clinic) => {
          const draft = clinic.latestSettingsDraft;
          const editable = !draft || draft.status === 'DRAFT' || draft.status === 'RETURNED_FOR_REWORK';
          return (
            <article className="practice-location-card" key={clinic.id}>
              <div>
                <div className="practice-location-title-row">
                  <h2>{clinicName(clinic)}</h2>
                  <span className="practice-status">{clinic.lifecycleStatus.replaceAll('_', ' ')}</span>
                </div>
                <p>{clinicAddress(clinic)}</p>
                <div className="practice-location-meta">
                  <span>{clinic.timeZone || 'Time zone not configured'}</span>
                  <span>{clinic.contactNumber || 'No contact number'}</span>
                  <span>{clinic.isBookingEnabled ? 'Booking enabled' : 'Booking not enabled'}</span>
                </div>
                <div className="practice-location-meta">
                  <span><strong>Settings draft:</strong> {draft ? draftStatusLabel(draft.status) : 'None'}</span>
                  {draft?.reviewComment ? <span><strong>Doctor note:</strong> {draft.reviewComment}</span> : null}
                </div>
              </div>
              <div className="practice-card-actions">
                {editable ? (
                  <button className="secondary" type="button" disabled={workingClinicId === clinic.id} onClick={() => void startOrContinueDraft(clinic)}>
                    {workingClinicId === clinic.id ? 'Opening…' : draft ? 'Continue settings draft' : 'Start settings draft'}
                  </button>
                ) : draft ? (
                  <button className="secondary" type="button" onClick={() => openDraft(draft)}>{draft.status === 'SUBMITTED' ? 'View submitted draft' : 'View closed draft'}</button>
                ) : null}
              </div>
            </article>
          );
        })}
      </section>
    </section>
  );
}
