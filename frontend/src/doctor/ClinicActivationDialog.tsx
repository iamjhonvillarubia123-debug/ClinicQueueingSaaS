import { FormEvent, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, apiRequest } from '../api/client';

type ClinicActivationDialogProps = {
  open: boolean;
  practiceLocationId: string;
  clinicName: string;
  onClose: () => void;
  onActivated: () => void | Promise<void>;
};

function messageFrom(error: unknown) {
  return error instanceof ApiError
    ? error.message
    : 'Unable to activate this clinic. Please try again.';
}

export function ClinicActivationDialog({
  open,
  practiceLocationId,
  clinicName,
  onClose,
  onActivated,
}: ClinicActivationDialogProps) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const passwordRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) {
      setCurrentPassword('');
      setError('');
      setSubmitting(false);
      return;
    }
    window.setTimeout(() => passwordRef.current?.focus(), 0);
  }, [open]);

  if (!open) return null;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!currentPassword || submitting) return;
    setSubmitting(true);
    setError('');
    try {
      await apiRequest('/practice-location/activate', {
        method: 'POST',
        headers: { 'Idempotency-Key': crypto.randomUUID() },
        body: { practiceLocationId, currentPassword },
      });
      await onActivated();
      onClose();
    } catch (caught) {
      setError(messageFrom(caught));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="clinic-modal-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.currentTarget === event.target && !submitting) onClose();
    }}>
      <section className="clinic-modal" role="dialog" aria-modal="true" aria-labelledby="clinic-activation-dialog-heading">
        <div className="clinic-modal-heading">
          <div>
            <p className="eyebrow">Activate clinic</p>
            <h2 id="clinic-activation-dialog-heading">Make {clinicName} active?</h2>
          </div>
          <button className="clinic-modal-close" type="button" aria-label="Close" disabled={submitting} onClick={onClose}>×</button>
        </div>

        <p className="practice-muted">Activation makes this clinic operationally active. The system will re-check clinic hours, Doctor Calendar conflicts, other active-clinic schedules, and the current Data Retention Acknowledgement before activation succeeds.</p>
        <div className="practice-notice">
          <strong>Before confirming</strong><br />Save any clinic configuration changes first. Services, booking questions, and Secretary assignment are not required for activation.
        </div>
        <Link className="quiet-link" to="/app/data-privacy">Review Data & Privacy →</Link>

        <form className="activation-confirm-form" onSubmit={submit}>
          <label>Current password<input ref={passwordRef} type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => { setCurrentPassword(event.target.value); setError(''); }} /></label>
          {error ? <div className="form-error" role="alert">{error}</div> : null}
          <div className="button-row">
            <button className="primary" type="submit" disabled={submitting || !currentPassword}>{submitting ? 'Activating clinic…' : 'Confirm activation'}</button>
            <button className="secondary" type="button" disabled={submitting} onClick={onClose}>Cancel</button>
          </div>
        </form>
      </section>
    </div>
  );
}
