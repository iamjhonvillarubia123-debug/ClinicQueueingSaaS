import { FormEvent, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, apiRequest } from '../api/client';

type DataPrivacyProfile = {
  acknowledgementVersion: string;
  jurisdiction: string;
  terminalAppointmentIdentifiableRetentionHours: number;
  permanentlyClosedAccountMinimizationDays: number;
  patientIdentifiableHistoryIsPermanent: boolean;
  finalPrivacyErasureIsIrreversible: boolean;
  erasedVisitIdentityCanBeRecovered: boolean;
  anonymousAggregateQueueAnalyticsMayRemain: boolean;
  clinicRetentionExtensionConfigurable: boolean;
  clinicPermanentClinicalRecordResponsibility: boolean;
  currentAcknowledgementSatisfied: boolean;
  acknowledgedAt: string | null;
};

function messageFrom(error: unknown) {
  return error instanceof ApiError
    ? error.message
    : 'Unable to update the Data & Privacy acknowledgement. Please try again.';
}

export function DoctorDataPrivacyPage() {
  const [profile, setProfile] = useState<DataPrivacyProfile | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function load() {
    setLoading(true);
    setError('');
    try {
      setProfile(await apiRequest<DataPrivacyProfile>('/doctor/account/data-privacy'));
    } catch (caught) {
      setError(messageFrom(caught));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!acknowledged || profile?.currentAcknowledgementSatisfied) return;
    setSubmitting(true);
    setError('');
    setNotice('');
    try {
      await apiRequest('/doctor/account/data-retention-acknowledgement', {
        method: 'POST',
        body: { acknowledged: true },
      });
      setAcknowledged(false);
      await load();
      setNotice('Data Retention Acknowledgement recorded.');
    } catch (caught) {
      setError(messageFrom(caught));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="practice-admin-page data-privacy-page" aria-labelledby="data-privacy-heading">
      <div className="practice-admin-heading">
        <div>
          <p className="eyebrow">Doctor settings</p>
          <h1 id="data-privacy-heading">Data & Privacy</h1>
          <p>Review how patient-identifiable queue data is retained before beginning real patient operations.</p>
        </div>
        <Link className="secondary-action" to="/app/practice-locations">← Back to clinic locations</Link>
      </div>

      {error ? <div className="form-error" role="alert">{error}</div> : null}
      {notice ? <div className="practice-notice practice-success" role="status">{notice}</div> : null}
      {loading ? <p className="practice-muted">Loading Data & Privacy settings…</p> : null}

      {profile ? (
        <>
          <section className="practice-create-panel">
            <div className="practice-panel-heading">
              <p className="eyebrow">Retention profile</p>
              <h2>What this system retains</h2>
              <p>The current Version 1 profile is configured for {profile.jurisdiction === 'PHILIPPINES' ? 'Philippine' : profile.jurisdiction} operation.</p>
            </div>
            <div className="privacy-facts">
              <p><strong>Clinic Queueing is not permanent patient-record storage.</strong> Patient-identifiable Appointment and queue data has a short operational retention period.</p>
              <p><strong>Final privacy erasure is irreversible.</strong> Once eligible patient identity is erased, an old visit cannot be recovered by patient identity.</p>
              <p><strong>Anonymous queue analytics may remain.</strong> Aggregate operational statistics may survive without reusable patient identity.</p>
              <p><strong>Your clinic remains responsible for permanent clinical records.</strong> Medical records that must be kept permanently or for another legal period must be maintained outside this queueing SaaS.</p>
            </div>
          </section>

          <section className="practice-create-panel">
            <div className="practice-panel-heading">
              <p className="eyebrow">Required acknowledgement</p>
              <h2>Data Retention Acknowledgement</h2>
              <p>This acknowledgement is separate from general Terms acceptance and is required before clinic activation and real patient operations.</p>
            </div>

            {profile.currentAcknowledgementSatisfied ? (
              <div className="practice-notice practice-success" role="status">
                <strong>Acknowledgement complete.</strong>
                {profile.acknowledgedAt ? ` Recorded ${new Date(profile.acknowledgedAt).toLocaleString()}.` : ''}
              </div>
            ) : (
              <form className="privacy-acknowledgement-form" onSubmit={submit}>
                <label className="inline-check privacy-acknowledgement-check">
                  <input
                    type="checkbox"
                    checked={acknowledged}
                    onChange={(event) => setAcknowledged(event.target.checked)}
                  />
                  <span>
                    I acknowledge that Clinic Queueing SaaS is not permanent patient-record storage, final privacy erasure is irreversible, erased visit identity cannot be recovered, and my clinic is responsible for maintaining any required permanent clinical or medical record outside this system.
                  </span>
                </label>
                <button className="primary" type="submit" disabled={!acknowledged || submitting}>
                  {submitting ? 'Recording acknowledgement…' : 'Record acknowledgement'}
                </button>
              </form>
            )}

            <p className="practice-muted privacy-version">Policy version: {profile.acknowledgementVersion}</p>
          </section>
        </>
      ) : null}
    </section>
  );
}
