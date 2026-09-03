import { useState } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionSettings } from './SessionSettings';

function Wrapper() {
  const [panel, setPanel] = useState('');
  return (
    <SessionSettings
      panel={panel}
      onOpen={setPanel}
      onClose={() => setPanel('')}
    />
  );
}
function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
const current = {
  id: 'current',
  isCurrent: true,
  createdAt: '2026-09-03T08:00:00Z',
  lastSeenAt: '2026-09-03T09:00:00Z',
  expiresAt: '2026-09-04T08:00:00Z',
};
const other = { ...current, id: 'other', isCurrent: false };
beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    },
  });
});
afterEach(() => vi.restoreAllMocks());
describe('Session Settings', () => {
  it('renders real sessions without a revoke-current-session button', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      response({ sessions: [current, other] }),
    );
    render(<Wrapper />);
    expect(
      await screen.findByText('This device (Current Session)'),
    ).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Sign Out' })).toHaveLength(1);
    expect(screen.queryByText('Chrome on Windows')).not.toBeInTheDocument();
  });
  it('requires confirmation, revokes one session, and refreshes the list', async () => {
    let revoked = false;
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (_url, options) => {
        if (options?.method === 'POST') {
          revoked = true;
          return response({ revoked: true });
        }
        return response({ sessions: revoked ? [current] : [current, other] });
      });
    const user = userEvent.setup();
    render(<Wrapper />);
    await user.click(await screen.findByRole('button', { name: 'Sign Out' }));
    expect(
      fetchMock.mock.calls.filter(([, options]) => options?.method === 'POST'),
    ).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: 'Confirm Sign Out' }));
    await screen.findByText('No other active sessions.');
    expect(
      fetchMock.mock.calls.find(
        ([, options]) => options?.method === 'POST',
      )?.[0],
    ).toContain('/auth/sessions/other/revoke');
  });
  it('sends the password to the bulk endpoint and leaves the list unchanged on failure', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (_url, options) =>
        options?.method === 'POST'
          ? response({ message: 'Current password is incorrect.' }, 401)
          : response({ sessions: [current, other] }),
      );
    const user = userEvent.setup();
    render(<Wrapper />);
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Sign Out All Other Sessions' }),
      ).toBeEnabled(),
    );
    await user.click(
      screen.getByRole('button', { name: 'Sign Out All Other Sessions' }),
    );
    const dialog = screen.getByRole('dialog');
    expect(
      within(dialog).getByRole('button', { name: 'Sign Out Others' }),
    ).toBeDisabled();
    await user.type(
      within(dialog).getByLabelText('Current Password'),
      'wrong-password',
    );
    await user.click(
      within(dialog).getByRole('button', { name: 'Sign Out Others' }),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('incorrect');
    expect(
      screen.getByRole('button', { name: 'Sign Out' }),
    ).toBeInTheDocument();
    const call = fetchMock.mock.calls.find(
      ([, options]) => options?.method === 'POST',
    );
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({
      currentPassword: 'wrong-password',
    });
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
