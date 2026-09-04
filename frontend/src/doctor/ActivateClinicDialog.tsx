import { FormEvent, useState } from 'react';
import { apiRequest } from '../api/client';
import './ApplyClinicChangesDialog.css';

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

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    if (!password) {
      setError('Enter your current password to activate this clinic.');
      return;
    }

    setSubmitting(true);
    setError('');
    try {
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
          <label>
            Current password
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              disabled={submitting}
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
            <button className="clinic-primary" type="submit" disabled={submitting}>
              {submitting ? 'Activating…' : 'Confirm and Activate'}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
