import { useState } from 'react';
import { apiRequest } from '../../api/client';
import {
  Card,
  dateTime,
  Drawer,
  LoadState,
  Note,
  PasswordField,
  useSettingsData,
} from './SettingsShared';

type Session = {
  id: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  idleExpiresAt: string;
  isCurrent: boolean;
};
type Sessions = { sessions: Session[]; deviceDetailsAvailable: boolean };

function RevokeSessionPanel({
  session,
  onClose,
  onSaved,
}: {
  session: Session | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit() {
    setBusy(true);
    setError('');
    try {
      await apiRequest(
        session
          ? `/auth/sessions/${encodeURIComponent(session.id)}/revoke`
          : '/auth/sessions/revoke-others',
        {
          method: 'POST',
          ...(session ? {} : { body: { currentPassword: password } }),
        },
      );
      setPassword('');
      onSaved();
      onClose();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Unable to end sessions.',
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Drawer
      title={session ? 'Sign Out Session' : 'Sign Out All Other Sessions'}
      busy={busy}
      onClose={onClose}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <Note>
          Your current session will remain signed in.{' '}
          {session
            ? 'The selected session will lose access on its next request.'
            : 'Other sessions active when this action runs will lose access. New sign-ins afterward are still possible.'}
        </Note>
        {session ? (
          <p>
            Selected session started {dateTime(session.createdAt)}. Last
            activity: {dateTime(session.lastSeenAt)}.
          </p>
        ) : (
          <PasswordField
            label="Current Password"
            value={password}
            onChange={setPassword}
            disabled={busy}
          />
        )}
        {error && (
          <p className="ds-error" role="alert">
            {error}
          </p>
        )}
        <footer>
          <button type="button" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button
            className="ds-primary"
            disabled={busy || (!session && !password)}
          >
            {busy
              ? 'Signing out…'
              : session
                ? 'Confirm Sign Out'
                : 'Sign Out Others'}
          </button>
        </footer>
      </form>
    </Drawer>
  );
}

export function SessionSettings({
  panel,
  onOpen,
  onClose,
}: {
  panel: string;
  onOpen: (panel: string) => void;
  onClose: () => void;
}) {
  const sessions = useSettingsData<Sessions>('/auth/sessions');
  const [target, setTarget] = useState<Session | null>(null);
  const [message, setMessage] = useState('');
  const others =
    sessions.data?.sessions.filter((session) => !session.isCurrent) ?? [];
  function saved() {
    sessions.reload();
    setMessage('Session access updated. Your current session was kept.');
  }
  const list = (
    <>
      <LoadState
        error={sessions.error}
        loading={!sessions.data}
        retry={sessions.reload}
      />
      {sessions.data?.sessions.map((session) => (
        <div key={session.id} className="ds-soft-row">
          <div>
            <strong>
              {session.isCurrent
                ? 'This device (Current Session)'
                : `Session started ${dateTime(session.createdAt)}`}
            </strong>
            <small>Last activity: {dateTime(session.lastSeenAt)}</small>
            <small>Expires: {dateTime(session.expiresAt)}</small>
          </div>
          {session.isCurrent ? (
            <span className="ds-badge">CURRENT SESSION</span>
          ) : (
            <button
              onClick={() => {
                setTarget(session);
                onOpen('Sign Out Session');
              }}
            >
              Sign Out
            </button>
          )}
        </div>
      ))}
      {sessions.data && !others.length && <p>No other active sessions.</p>}
      <p className="ds-muted">
        Browser names and locations were not stored for these sessions. They are
        not guessed or collected here.
      </p>
    </>
  );
  return (
    <>
      <Card
        title="3. Active Sessions"
        description="Review and end access from your other signed-in sessions."
        icon="globe"
      >
        {list}
        {message && (
          <p role="status" className="ds-success">
            {message}
          </p>
        )}
        <button onClick={() => onOpen('Manage Active Sessions')}>
          Manage Active Sessions
        </button>{' '}
        <button
          disabled={!others.length}
          onClick={() => onOpen('Sign Out All Other Sessions')}
        >
          Sign Out All Other Sessions
        </button>
      </Card>
      {panel === 'Manage Active Sessions' && (
        <Drawer title={panel} onClose={onClose}>
          {list}
          <footer>
            <button onClick={onClose}>Close</button>
          </footer>
        </Drawer>
      )}
      {(panel === 'Sign Out Session' ||
        panel === 'Sign Out All Other Sessions') && (
        <RevokeSessionPanel
          key={panel === 'Sign Out Session' ? target?.id : 'all'}
          session={panel === 'Sign Out Session' ? target : null}
          onClose={onClose}
          onSaved={saved}
        />
      )}
    </>
  );
}
