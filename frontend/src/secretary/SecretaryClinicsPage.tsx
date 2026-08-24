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
  access: {
    accessProfile: 'STANDARD' | 'FULL_CLINIC_CONFIGURATION' | 'CUSTOM';
    canManageClinicDetails: boolean;
    canManageServices: boolean;
    canManageBookingQuestions: boolean;
    canManageSchedules: boolean;
    capabilities: Array<{ capabilityType: 'CANCEL_CLINIC_DAY' | 'ASSIGN_DAY_SECRETARY' }>;
  };
  latestSettingsDraft: DraftSummary | null;
  settingsDrafts: DraftSummary[];
};

function clinicName(clinic: AssignedClinic) {
  return clinic.name?.trim() || 'Untitled clinic location';
}
function clinicAddress(clinic: AssignedClinic) {
  const parts = [clinic.addressLine1, clinic.addressLine2, clinic.cityMunicipality, clinic.province, clinic.postalCode]
    .map((value) => value?.trim()).filter(Boolean);
  return parts.length ? parts.join(', ') : 'Address not configured';
}
function profileLabel(profile: AssignedClinic['access']['accessProfile']) {
  if (profile === 'FULL_CLINIC_CONFIGURATION') return 'Full clinic configuration';
  if (profile === 'CUSTOM') return 'Custom access';
  return 'Standard access';
}
function messageFrom(error: unknown) {
  return error instanceof ApiError ? error.message : 'Unable to load assigned clinics. Please try again.';
}
function canConfigure(clinic: AssignedClinic) {
  const access = clinic.access;
  return access.canManageClinicDetails || access.canManageServices || access.canManageBookingQuestions || access.canManageSchedules;
}

export function SecretaryClinicsPage() {
  const navigate = useNavigate();
  const [clinics, setClinics] = useState<AssignedClinic[]>([]);
  const [loading, setLoading] = useState(true);
  const [workingClinicId, setWorkingClinicId] = useState('');
  const [error, setError] = useState('');

  async function load() {
    setLoading(true); setError('');
    try { setClinics(await apiRequest<AssignedClinic[]>('/secretary-workspace/clinics')); }
    catch (caught) { setError(messageFrom(caught)); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);

  async function startOrContinueDraft(clinic: AssignedClinic) {
    setWorkingClinicId(clinic.id); setError('');
    try {
      const draft = await apiRequest<{ id: string; status: DraftSummary['status']; reused: boolean }>('/secretary-settings-drafts', {
        method: 'POST', body: { practiceLocationId: clinic.id },
      });
      navigate(`/app/secretary/settings-drafts/${encodeURIComponent(draft.id)}`);
    } catch (caught) { setError(messageFrom(caught)); setWorkingClinicId(''); }
  }
  function openDraft(draft: DraftSummary) { navigate(`/app/secretary/settings-drafts/${encodeURIComponent(draft.id)}`); }

  return (
    <section className="practice-admin-page secretary-clinics-page" aria-labelledby="secretary-clinics-heading">
      <div className="practice-admin-heading"><div><p className="eyebrow">Secretary workspace</p><h1 id="secretary-clinics-heading">Assigned clinics</h1><p>Open a clinic to prepare configuration proposals within the access granted by its Doctor.</p></div></div>
      {error ? <div className="form-error" role="alert">{error}</div> : null}
      {loading ? <p className="practice-muted">Loading assigned clinics…</p> : null}
      {!loading && clinics.length === 0 ? <div className="practice-empty"><h2>No assigned clinics</h2><p>You currently have no regular Secretary assignment.</p></div> : null}

      <section className="secretary-clinic-list" aria-label="Assigned clinics">
        {clinics.map((clinic) => {
          const draft = clinic.latestSettingsDraft;
          const configurable = canConfigure(clinic);
          const submitted = draft?.status === 'SUBMITTED';
          const activeDraft = draft?.status === 'DRAFT' || draft?.status === 'RETURNED_FOR_REWORK';
          return (
            <article className="secretary-clinic-card" key={clinic.id}>
              <div className="secretary-clinic-copy">
                <div className="practice-location-title-row"><h2>{clinicName(clinic)}</h2><span className="practice-status">{clinic.lifecycleStatus.replaceAll('_', ' ')}</span></div>
                <p className="secretary-clinic-address">{clinicAddress(clinic)}</p>
                <div className="secretary-clinic-facts"><span>{clinic.timeZone || 'Time zone not configured'}</span><span>{clinic.contactNumber || 'No contact number'}</span><span>{profileLabel(clinic.access.accessProfile)}</span></div>
                <div className="secretary-clinic-access"><span><strong>Queue operations</strong> Standard authority</span><span><strong>Configuration</strong> {configurable ? 'Proposal access granted' : 'Not granted'}</span>{configurable && submitted ? <span><strong>Proposal</strong> Waiting for Doctor review</span> : null}{configurable && activeDraft ? <span><strong>Proposal</strong> Draft in progress</span> : null}</div>
              </div>
              <div className="secretary-clinic-action">
                {!configurable ? <span className="practice-muted">Operational workspace only</span> : submitted && draft ? <button className="secondary" type="button" onClick={() => openDraft(draft)}>View pending proposal</button> : <button className="primary" type="button" disabled={workingClinicId === clinic.id} onClick={() => void startOrContinueDraft(clinic)}>{workingClinicId === clinic.id ? 'Opening…' : 'Propose changes'}</button>}
                {configurable ? <p>Draft proposals only.<br />Doctor approval is required.</p> : null}
              </div>
            </article>
          );
        })}
      </section>
    </section>
  );
}
