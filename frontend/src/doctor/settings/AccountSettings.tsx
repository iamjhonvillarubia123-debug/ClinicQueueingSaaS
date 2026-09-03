import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiRequest } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import {
  Card,
  Checklist,
  Drawer,
  Help,
  Note,
  PasswordField,
  Unconnected,
} from './SettingsShared';

const securityNotes = [
  'Account details are shown only when available from the server.',
  'Routine settings and sensitive account actions have different requirements.',
  'Disabling your account is reversible.',
  'Permanent account deletion cannot be undone.',
];
const deletionNotes = [
  'You will lose access to this account and its clinics.',
  'Your public profile, booking links, and QR codes will stop working.',
  'Patients will no longer be able to book under this account.',
  'Data follows the system retention policy; deletion does not mean immediate erasure of every record.',
  'This account cannot be reactivated. You will need a new account to use Clinic Queueing again.',
];

export function AccountSettings() {
  const { profile, refresh } = useAuth();
  const navigate = useNavigate();
  const [panel, setPanel] = useState('');
  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [email, setEmail] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [key] = useState(() => `settings-close-${crypto.randomUUID()}`);
  function open(value: string) {
    setPanel(value);
    setPassword('');
    setNewPassword('');
    setConfirmation('');
    setEmail('');
    setAcknowledged(false);
    setError('');
  }
  function close() {
    if (!busy) open('');
  }
  async function permanentlyDelete() {
    setBusy(true);
    setError('');
    try {
      await apiRequest('/doctor/account/permanent-delete', {
        method: 'POST',
        headers: { 'Idempotency-Key': key },
        body: { email, password, confirmPermanentDelete: acknowledged },
      });
      setPassword('');
      await refresh();
      navigate('/login', { replace: true });
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Unable to delete your account.',
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="ds-main">
        <p>
          Manage your account information, security, and access to your account.
        </p>
        <Card
          title="1. Account Information"
          description="Your basic account details and current status."
          icon="person"
        >
          <div className="ds-account-grid">
            <div>
              <small>Name</small>
              <strong>Not available</strong>
            </div>
            <div>
              <small>Role</small>
              <strong>
                {profile?.role === 'DOCTOR' ? 'Doctor' : 'Not available'}
              </strong>
            </div>
            <div>
              <small>Email</small>
              <strong>Not available</strong>
            </div>
            <div>
              <small>Email status</small>
              <strong>Not available</strong>
            </div>
            <div>
              <small>Account status</small>
              <strong>Not available</strong>
            </div>
          </div>
          <div className="ds-end">
            <button onClick={() => open('View Profile')}>View Profile</button>
          </div>
        </Card>
        <Card
          title="2. Password & Security"
          description="Manage your password to keep your account secure."
          icon="shield"
        >
          <div className="ds-row">
            <div>
              <small>Password</small>
              <strong>••••••••••••</strong>
              <small>Last changed: Not available</small>
            </div>
            <button onClick={() => open('Change Password')}>
              Change Password
            </button>
          </div>
        </Card>
        <Card
          title="3. Active Sessions"
          description="Devices where your account is currently signed in."
          icon="globe"
        >
          <div className="ds-soft-row">
            <span>This device</span>
            <span className="ds-badge">Current workspace</span>
          </div>
          <p className="ds-muted">
            Device details and other sessions are not available from the current
            backend.
          </p>
          <button onClick={() => open('Manage Active Sessions')}>
            Manage Active Sessions
          </button>{' '}
          <button onClick={() => open('Sign Out All Other Sessions')}>
            Sign Out All Other Sessions
          </button>
        </Card>
        <Card
          title="4. Account Management"
          description="Disable or permanently delete your account."
          icon="shield"
        >
          <div className="ds-soft-row ds-warning">
            <div>
              <strong>Disable Account</strong>
              <small>
                Temporarily disable your Doctor account. You can reactivate it
                later.
              </small>
            </div>
            <button onClick={() => open('Disable Account')}>
              Disable Account
            </button>
          </div>
          <div className="ds-soft-row ds-danger-soft">
            <div>
              <strong>Permanently Delete Account</strong>
              <small>
                Permanently close your account. This cannot be undone.
              </small>
            </div>
            <button
              className="ds-danger-text"
              onClick={() => open('Permanently Delete Account')}
            >
              Delete Account Permanently
            </button>
          </div>
        </Card>
      </div>
      <aside className="ds-aside">
        <Card title="About Account Security" icon="info">
          <Checklist items={securityNotes} />
        </Card>
        <Card title="Security Actions" icon="shield">
          {[
            'Change Password',
            'Manage Active Sessions',
            'Sign Out All Other Sessions',
          ].map((action) => (
            <button
              className="ds-quick"
              key={action}
              onClick={() => open(action)}
            >
              {action}
              <span>›</span>
            </button>
          ))}
        </Card>
        <Help title="Account Help" items={securityNotes} />
      </aside>
      {panel && (
        <Drawer title={panel} onClose={close} busy={busy}>
          {panel === 'View Profile' && (
            <>
              <p>Doctor account</p>
              <dl>
                <dt>Account ID</dt>
                <dd>{profile?.userId}</dd>
                <dt>Role</dt>
                <dd>Doctor</dd>
              </dl>
              <Unconnected reason="The authenticated profile endpoint exposes only an account ID and role, not your name, email, verification, or professional profile." />
            </>
          )}
          {panel === 'Change Password' && (
            <>
              <p>Update your password to keep your account secure.</p>
              <PasswordField
                label="Current Password"
                value={password}
                onChange={setPassword}
              />
              <PasswordField
                label="New Password"
                value={newPassword}
                onChange={setNewPassword}
                newPassword
              />
              <PasswordField
                label="Confirm New Password"
                value={confirmation}
                onChange={setConfirmation}
                newPassword
              />
              <Unconnected reason="There is no signed-in change-password endpoint. Email-based password recovery is a separate workflow." />
              <div className="ds-editor">
                <h3>Password requirements in the approved design</h3>
                <Checklist
                  items={[
                    'At least 8 characters',
                    'Uppercase and lowercase letters',
                    'At least one number',
                    'At least one special character',
                  ]}
                />
                <small>
                  These proposed requirements are not yet enforced by a
                  change-password backend.
                </small>
              </div>
              <button disabled>Update Password</button>
            </>
          )}
          {panel === 'Manage Active Sessions' && (
            <Unconnected reason="The server does not expose a session list or per-device sign-out endpoint." />
          )}
          {panel === 'Sign Out All Other Sessions' && (
            <>
              <Note>
                This would sign you out of all other devices except this one.
              </Note>
              <PasswordField
                label="Password"
                value={password}
                onChange={setPassword}
              />
              <Unconnected reason="There is no password-verified sign-out-other-sessions endpoint." />
              <button disabled>Sign Out Others</button>
            </>
          )}
          {panel === 'Disable Account' && (
            <>
              <Note warning>
                You are about to disable your account temporarily.
              </Note>
              <Checklist
                items={[
                  'You would be signed out of your devices.',
                  'Clinic access and new bookings would stop.',
                  'Your data and settings would follow the account retention policy.',
                  'You can reactivate a voluntarily disabled account later.',
                ]}
              />
              <PasswordField
                label="Password"
                value={password}
                onChange={setPassword}
              />
              <Unconnected reason="Disablement exists, but its endpoint does not verify the password required by this design. It is intentionally not called here." />
              <button disabled>Disable Account</button>
            </>
          )}
          {panel === 'Permanently Delete Account' && (
            <>
              <Note warning>
                This action is permanent and cannot be undone.
              </Note>
              <Checklist items={deletionNotes} />
              <button
                className="ds-danger"
                onClick={() => setPanel('Confirm Permanent Deletion')}
              >
                Continue
              </button>
            </>
          )}
          {panel === 'Confirm Permanent Deletion' && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void permanentlyDelete();
              }}
            >
              <Note warning>
                Final confirmation required. Enter the email and password of the
                Doctor account you intend to permanently close.
              </Note>
              <label>
                Doctor account email
                <input
                  type="email"
                  autoComplete="username"
                  required
                  value={email}
                  disabled={busy}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </label>
              <PasswordField
                label="Password"
                value={password}
                onChange={setPassword}
                disabled={busy}
              />
              <label className="ds-checkbox">
                <input
                  type="checkbox"
                  required
                  checked={acknowledged}
                  disabled={busy}
                  onChange={(event) => setAcknowledged(event.target.checked)}
                />
                I understand that this account cannot be reactivated and this
                action is irreversible.
              </label>
              {error && (
                <p role="alert" className="ds-error">
                  {error}
                </p>
              )}
              <button
                className="ds-danger"
                disabled={busy || !acknowledged || !password || !email}
              >
                {busy ? 'Deleting…' : 'Permanently Delete My Account'}
              </button>
            </form>
          )}
          <footer>
            <button onClick={close} disabled={busy}>
              {panel === 'View Profile' ? 'Close' : 'Cancel'}
            </button>
          </footer>
        </Drawer>
      )}
    </>
  );
}
