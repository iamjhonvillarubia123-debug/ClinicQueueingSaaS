import { FormEvent, useState } from 'react';
import { apiRequest } from '../api/client';
import './ApplyClinicChangesDialog.css';

export function PermanentlyDeleteClinicDialog({
  practiceLocationId,
  clinicName,
  onDeleted,
  onCancel,
}: {
  practiceLocationId: string;
  clinicName: string;
  onDeleted: () => Promise<void> | void;
  onCancel: () => void;
}) {
  const [password, setPassword] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    if (!confirmed) {
      setError('Confirm that you understand this clinic deletion is permanent.');
      return;
    }
    if (!password) {
      setError('Enter your current password to permanently delete this clinic.');
      return;
    }

    setSubmitting(true);
    setError('');
    try {
      await apiRequest<{ permanentlyDeleted: true; replayed: boolean }>(
        '/practice-location/permanent-delete',
        {
          method: 'POST',
          headers: { 'Idempotency-Key': idempotencyKey },
          body: {
            practiceLocationId,
            password,
            confirmPermanentDelete: true,
          },
        },
      );
      await onDeleted();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Unable to permanently delete this clinic.',
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
        aria-labelledby="delete-clinic-title"
      >
        <h2 id="delete-clinic-title">Permanently delete clinic</h2>
        <p>
          <strong>{clinicName || 'This clinic'}</strong> will be permanently
          removed from normal clinic operations. Historical records required
          for audit and retention are preserved, but this clinic cannot be
          restored through the normal clinic lifecycle.
        </p>
        <form onSubmit={submit}>
          <label className="clinic-confirmation-check">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
              disabled={submitting}
            />
            I understand that this clinic deletion is permanent.
          </label>
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
              {submitting ? 'Deleting…' : 'Permanently Delete Clinic'}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
