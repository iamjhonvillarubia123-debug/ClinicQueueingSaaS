import { useEffect, useState } from 'react';
import { apiRequest } from '../../api/client';
import { Note, PasswordField } from './SettingsShared';
export function AccountDataDownload({
  settingsOnly = false,
  busy,
  setBusy,
}: {
  settingsOnly?: boolean;
  busy: boolean;
  setBusy: (value: boolean) => void;
}) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [url, setUrl] = useState('');
  useEffect(
    () => () => {
      if (url) URL.revokeObjectURL(url);
    },
    [url],
  );
  async function prepare() {
    setBusy(true);
    setError('');
    try {
      const data = await apiRequest('/doctor/account/export', {
        method: 'POST',
        body: {
          currentPassword: password,
          kind: settingsOnly ? 'SETTINGS' : 'ACCOUNT',
        },
      });
      setUrl(
        URL.createObjectURL(
          new Blob([JSON.stringify(data, null, 2)], {
            type: 'application/json',
          }),
        ),
      );
      setPassword('');
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Unable to prepare download.',
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Note>
        This download contains only{' '}
        {settingsOnly
          ? 'your Doctor-wide account settings'
          : 'your own account details, Doctor-wide settings, and policy acknowledgements'}
        . It excludes patient information, clinic records, booking answers,
        other users, passwords, and authentication secrets. It is not a complete
        system backup and cannot be imported.
      </Note>
      {url ? (
        <p role="status">
          <a
            href={url}
            download={
              settingsOnly
                ? 'doctor-account-settings.json'
                : 'doctor-account-data.json'
            }
          >
            Download account {settingsOnly ? 'settings backup' : 'data'}
          </a>
        </p>
      ) : (
        <>
          <PasswordField
            label="Current Password"
            value={password}
            onChange={setPassword}
          />
          <button
            disabled={busy || !password}
            className="ds-primary"
            onClick={() => void prepare()}
          >
            {busy ? 'Preparing…' : 'Prepare Download'}
          </button>
        </>
      )}
      {error && (
        <p role="alert" className="ds-error">
          {error}
        </p>
      )}
    </>
  );
}
