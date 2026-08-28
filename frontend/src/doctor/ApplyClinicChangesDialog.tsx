import { FormEvent, useState } from 'react';
import { apiRequest } from '../api/client';

export function ApplyClinicChangesDialog({
  practiceLocationId,
  onApplied,
  onCancel,
}: {
  practiceLocationId: string;
  onApplied: () => Promise<void> | void;
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
      setError('Enter your current password to apply these clinic changes.');
      return;
    }

    setSubmitting(true);
    setError('');
    try {
      await apiRequest<{ applied: true; replayed: boolean }>(
        '/practice-location/apply-configuration-draft',
        {
          method: 'POST',
          headers: { 'Idempotency-Key': idempotencyKey },
          body: {
            practiceLocationId,
            password,
            confirmApply: true,
          },
        },
      );
      await onApplied();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Unable to apply the proposed clinic changes.',
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
        aria-labelledby="apply-clinic-changes-title"
      >
        <h2 id="apply-clinic-changes-title">Apply clinic changes</h2>
        <p>
          This replaces the clinic's current effective configuration with the
          proposed changes. The update is applied as one protected transaction.
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
              {submitting ? 'Applying…' : 'Confirm and Apply'}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
