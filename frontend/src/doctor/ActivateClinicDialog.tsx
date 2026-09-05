import { FormEvent, useEffect, useState } from 'react';
import { apiRequest } from '../api/client';
import './ApplyClinicChangesDialog.css';

type DataPrivacyProfile = {
  acknowledgementVersion: string;
  currentAcknowledgementSatisfied: boolean;
};

export function ActivateClinicDialog({
  practiceLocationId,
  onActivated,
  onCancel,
}: {
  practiceLocationId: string;
  onActivated: () => Promise<void> | void;
  onCancel: () => void;
}) {
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [retentionLoaded, setRetentionLoaded] = useState(false);
  const [retentionSatisfied, setRetentionSatisfied] = useState(false);
  const [retentionAccepted, setRetentionAccepted] = useState(false);

  useEffect(() => {
    let active = true;

    async function loadRetentionState() {
      try {
        const profile = await apiRequest<DataPrivacyProfile>(
          '/doctor/account/data-privacy',
        );
        if (!active) return;
        setRetentionSatisfied(profile.currentAcknowledgementSatisfied);
      } catch {
        if (!active) return;
        setError(
          'Unable to verify the current data-retention acknowledgement. Try again before activating this clinic.',
        );
      } finally {
        if (active) setRetentionLoaded(true);
      }
    }

    void loadRetentionState();
    return () => {
      active = false;
    };
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting || !retentionLoaded) return;
    if (!password) {
      setError('Enter your current password to activate this clinic.');
      return;
    }
    if (!retentionSatisfied && !retentionAccepted) {
      setError(
        'Confirm the Data Retention Acknowledgement before activating this clinic.',
      );
      return;
    }

    setSubmitting(true);
    setError('');
    try {
      if (!retentionSatisfied) {
        await apiRequest('/doctor/account/data-retention-acknowledgement', {
          method: 'POST',
          body: { acknowledged: true },
        });
        setRetentionSatisfied(true);
      }

      await apiRequest<{ activated: true; replayed: boolean }>(
        '/practice-location/activate',
        {
          method: 'POST',
          headers: { 'Idempotency-Key': idempotencyKey },
          body: {
            practiceLocationId,
            password,
            confirmActivation: true,
          },
        },
      );
      await onActivated();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Unable to activate this clinic.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="clinic-confirmation-backdrop" role="presentation">
      <section
        className="clinic-confirmation-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="activate-clinic-title"
      >
        <h2 id="activate-clinic-title">Activate clinic</h2>
        <p>
          Activating makes this practice location operational. Clinic hours are
          revalidated against the doctor's currently effective schedules before
          activation commits.
        </p>
        <form onSubmit={submit}>
          {!retentionLoaded ? (
            <p role="status">Checking data-retention acknowledgement…</p>
          ) : !retentionSatisfied ? (
            <label>
              <input
                type="checkbox"
                checked={retentionAccepted}
                onChange={(event) => setRetentionAccepted(event.target.checked)}
                disabled={submitting}
              />
              I understand that this queueing SaaS is not permanent patient-record
              storage, identifiable appointment and queue data is retained only for
              the approved short period, final privacy erasure is irreversible, old
              visits cannot be recovered by patient identity after final erasure,
              and the clinic must keep any required permanent clinical record
              outside this SaaS.
            </label>
          ) : null}
          <label>
            Current password
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              disabled={submitting || !retentionLoaded}
              autoFocus
            />
          </label>
          {error ? (
            <div className="form-error" role="alert">
              {error}
            </div>
          ) : null}
          <div className="clinic-confirmation-actions">
            <button
              className="clinic-secondary"
              type="button"
              disabled={submitting}
              onClick={onCancel}
            >
              Cancel
            </button>
            <button
              className="clinic-primary"
              type="submit"
              disabled={submitting || !retentionLoaded}
            >
              {submitting ? 'Activating…' : 'Confirm and Activate'}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
