import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiRequest } from '../api/client';
import { useAuth } from './AuthContext';
import { Checklist, Drawer, PasswordField } from '../doctor/settings/SettingsShared';

export function ChangePasswordDrawer({ onClose }: { onClose: () => void }) {
  const { clearSession } = useAuth();
  const navigate = useNavigate();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [key] = useState(() => `settings-password-${crypto.randomUUID()}`);
  const valid = Boolean(currentPassword) && [...newPassword].length >= 15 && [...newPassword].length <= 128 && newPassword === confirmation;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || !valid) return;
    setBusy(true);
    setError('');
    try {
      await apiRequest('/auth/account/change-password', {
        method: 'POST',
        headers: { 'Idempotency-Key': key },
        body: { currentPassword, newPassword, confirmNewPassword: confirmation },
      });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmation('');
      clearSession();
      navigate('/login', { replace: true });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to update your password.');
      setBusy(false);
    }
  }

  return <Drawer title="Change Password" onClose={onClose} busy={busy}>
    <form onSubmit={submit}>
      <p>Update your password to keep your account secure.</p>
      <PasswordField label="Current Password" value={currentPassword} onChange={setCurrentPassword} disabled={busy} />
      <PasswordField label="New Password" value={newPassword} onChange={setNewPassword} disabled={busy} newPassword />
      <PasswordField label="Confirm New Password" value={confirmation} onChange={setConfirmation} disabled={busy} newPassword />
      <div className="ds-editor">
        <h3>Choose a strong passphrase</h3>
        <Checklist items={[
          '15 to 128 characters; spaces and Unicode are supported.',
          'Avoid predictable or reused passwords.',
          'All sessions will end after a successful password change.',
        ]} />
        <small>Your current password and new passphrase are validated on the server.</small>
      </div>
      {error ? <div className="form-error" role="alert">{error}</div> : null}
      <button className="ds-primary" type="submit" disabled={busy || !valid}>{busy ? 'Updating Password…' : 'Update Password'}</button>
    </form>
  </Drawer>;
}
