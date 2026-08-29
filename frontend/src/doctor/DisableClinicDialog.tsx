import { FormEvent, useState } from 'react';
import { apiRequest } from '../api/client';
import './ApplyClinicChangesDialog.css';

export function DisableClinicDialog({
  practiceLocationId,
  onDisabled,
  onCancel,
}: {
  practiceLocationId: string;
  onDisabled: () => Promise<void> | void;
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
      setError('Enter your current password to disable this clinic.');
      return;
    }

    setSubmitting(true);
    setError('');
    try {
      await apiRequest<{ disabled: true; replayed: boolean }>(
        '/practice-location/disable',
        {
          method: 'POST',
          headers: { 'Idempotency-Key': idempotencyKey },
          body: {
            practiceLocationId,
            password,
            confirmDisable: true,
          },
        },
      );
      await onDisabled();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Unable to disable this clinic.',
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
        aria-labelledby="disable-clinic-title"
      >
        <h2 id="disable-clinic-title">Disable clinic</h2>
        <p>
          This makes the clinic unavailable for new appointments while
          preserving its configuration. A started clinic day must be closed or
          cancelled before the clinic can be disabled.
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
            <button
              className="clinic-primary"
              type="submit"
              disabled={submitting}
            >
              {submitting ? 'Disabling…' : 'Confirm and Disable'}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
