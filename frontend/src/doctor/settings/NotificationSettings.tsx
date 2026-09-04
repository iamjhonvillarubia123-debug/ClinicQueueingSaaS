import { useState } from 'react';
import { Link } from 'react-router-dom';
import { apiRequest } from '../../api/client';
import { OperationsIcon } from '../OperationsIcon';
import {
  Card,
  Checklist,
  dateTime,
  Drawer,
  Help,
  LoadState,
  Note,
  useSettingsData,
} from './SettingsShared';

type Notification = {
  title?: string | null;
  message?: string | null;
  affectedSecretaryName?: string;
  id: string;
  notificationType: string;
  affectedSecretaryUserId: string | null;
  practiceLocationId: string | null;
  createdAt: string;
  readAt: string | null;
};
const notes = [
  'Important clinic activity appears here.',
  'Unread notifications are highlighted.',
  'Patient communications are managed separately.',
  'Account security, payments, invitations, and administrator updates appear here.',
];
function title(item: Notification) {
  if (item.title) return item.title;
  return item.notificationType === 'SECRETARY_ACCOUNT_DISABLED'
    ? 'Secretary account disabled'
    : item.notificationType === 'SECRETARY_ACCOUNT_DELETED'
      ? 'Secretary account permanently deleted'
      : 'Clinic activity notification';
}

export function NotificationSettings() {
  const notifications = useSettingsData<Notification[]>(
    '/application-notifications',
  );
  const clinics =
    useSettingsData<{ id: string; name: string }[]>('/practice-location');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [limit, setLimit] = useState(5);
  const [selected, setSelected] = useState<Notification | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const items = notifications.data ?? [];
  const unread = items.filter((item) => !item.readAt);
  const filtered = unreadOnly ? unread : items;
  const clinicName = (id: string | null) =>
    clinics.data?.find((clinic) => clinic.id === id)?.name ??
    'Clinic details unavailable';
  async function markRead(targets: Notification[]) {
    setBusy(true);
    setError('');
    const results = await Promise.allSettled(
      targets.map((item) =>
        apiRequest<Notification>(
          `/application-notifications/${encodeURIComponent(item.id)}/read`,
          { method: 'PATCH' },
        ),
      ),
    );
    const updated = new Map(
      results.flatMap((result) =>
        result.status === 'fulfilled'
          ? [[result.value.id, result.value] as const]
          : [],
      ),
    );
    notifications.setData(
      (current) => current?.map((item) => updated.get(item.id) ?? item) ?? null,
    );
    if (results.some((result) => result.status === 'rejected'))
      setError(
        'Some notifications could not be marked as read. Successfully updated notifications were kept. Please retry the remaining items.',
      );
    setBusy(false);
  }
  return (
    <>
      <div className="ds-main">
        <p>
          Stay informed about important clinic, staff, account, and system
          activity.
        </p>
        <Card
          title="1. Recent Notifications"
          description="View the latest updates and alerts."
          icon="mail"
        >
          <div className="ds-notification-tools">
            <div className="ds-filters">
              <button
                aria-pressed={!unreadOnly}
                onClick={() => {
                  setUnreadOnly(false);
                  setLimit(5);
                }}
              >
                All ({items.length})
              </button>
              <button
                aria-pressed={unreadOnly}
                onClick={() => {
                  setUnreadOnly(true);
                  setLimit(5);
                }}
              >
                Unread ({unread.length})
              </button>
            </div>
            <button
              disabled={busy || !unread.length}
              onClick={() => void markRead(unread)}
            >
              Mark All as Read
            </button>
          </div>
          <LoadState
            error={notifications.error}
            loading={!notifications.data}
            retry={notifications.reload}
          />
          {error && (
            <p role="alert" className="ds-error">
              {error}
            </p>
          )}
          {filtered.slice(0, limit).map((item) => (
            <article
              className={`ds-notification${item.readAt ? '' : ' is-unread'}`}
              key={item.id}
            >
              <span className="ds-icon">
                <OperationsIcon name="person" />
              </span>
              <div>
                <button
                  className="ds-title-link"
                  onClick={() => setSelected(item)}
                >
                  {title(item)}
                </button>
                <p>
                  {item.message ??
                    'A secretary is no longer available under this clinic assignment.'}
                </p>
                <small>
                  {item.practiceLocationId
                    ? clinicName(item.practiceLocationId)
                    : 'Account'}{' '}
                  · {dateTime(item.createdAt)}
                </small>
              </div>
              <div className="ds-actions">
                <button onClick={() => setSelected(item)}>View Details</button>
                {!item.readAt ? (
                  <button
                    className="ds-primary"
                    disabled={busy}
                    onClick={() => void markRead([item])}
                  >
                    Mark as Read
                  </button>
                ) : (
                  <span aria-label="Read">
                    <OperationsIcon name="check" size={18} />
                  </span>
                )}
              </div>
            </article>
          ))}
          {notifications.data && !filtered.length && (
            <div className="ds-empty">
              <OperationsIcon name="mail" size={32} />
              <h3>
                {unreadOnly ? 'You’re all caught up' : 'No notifications yet'}
              </h3>
              <p>
                {unreadOnly
                  ? 'There are no unread notifications.'
                  : 'Supported clinic activity will appear here when it occurs.'}
              </p>
            </div>
          )}
          {filtered.length > limit && (
            <div className="ds-center">
              <button onClick={() => setLimit((value) => value + 5)}>
                Load More
              </button>
            </div>
          )}
        </Card>
      </div>
      <aside className="ds-aside">
        <Card title="About Notifications">
          <Checklist items={notes} />
        </Card>
        <Card title="Notification Summary" icon="calendar">
          <div className="ds-summary">
            <div>
              <strong>{notifications.data ? unread.length : '—'}</strong>
              <small>Unread</small>
            </div>
            <div>
              <strong>{notifications.data ? items.length : '—'}</strong>
              <small>Total notifications</small>
            </div>
          </div>
        </Card>
        <Card title="How You’ll Be Notified" icon="mail">
          <h3>Clinic & Staff Activity</h3>
          <p>
            In-app notices for invitations, acceptance, cancellation, and
            secretary account changes.
          </p>
          <h3>Account & Security</h3>
          <p>
            Password and account-status changes appear here. Email verification
            and password recovery remain separate workflows.
          </p>
          <Note>
            Payment and refund updates appear here. Authorized administrators
            can publish maintenance, developer, and compliance announcements.
          </Note>
        </Card>
        <Help title="Notification Guide" items={notes} />
      </aside>
      {selected && (
        <Drawer title={title(selected)} onClose={() => setSelected(null)}>
          {selected.notificationType !== 'ACCOUNT_ACTIVITY' && (
            <div className="ds-row">
              <span className="ds-icon">
                <OperationsIcon name="person" />
              </span>
              <div>
                <h3>Secretary</h3>
                <small>
                  {selected.affectedSecretaryName ??
                    'Profile details are not included in this notification.'}
                </small>
              </div>
            </div>
          )}
          <div className="ds-row">
            <OperationsIcon name="clinic" />
            <h3>
              {selected.practiceLocationId
                ? clinicName(selected.practiceLocationId)
                : 'Account notification'}
            </h3>
          </div>
          <h3>What happened</h3>
          <p>
            {selected.message ??
              `${title(selected)}. The secretary is no longer available under this clinic assignment.`}
          </p>
          {selected.notificationType !== 'ACCOUNT_ACTIVITY' && (
            <>
              <h3>What this means</h3>
              <Checklist
                items={[
                  'This notification does not cancel your clinic or existing appointments.',
                  'You may operate the clinic directly.',
                  'You may assign another eligible secretary.',
                ]}
              />
            </>
          )}
          {selected.notificationType === 'SECRETARY_ACCOUNT_DELETED' && (
            <Note warning>
              The permanently deleted account cannot be reactivated.
            </Note>
          )}
          <Note>
            This notification is for your awareness. Review the related account
            or clinic section if action is needed.
          </Note>
          <footer>
            {selected.practiceLocationId && (
              <Link
                className="ds-link-button"
                to={`/app/clinics/${encodeURIComponent(selected.practiceLocationId)}/operations`}
              >
                View Clinic
              </Link>
            )}
            <button onClick={() => setSelected(null)}>Close</button>
          </footer>
        </Drawer>
      )}
    </>
  );
}
