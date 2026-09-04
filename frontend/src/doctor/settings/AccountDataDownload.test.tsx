import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { AccountDataDownload } from './AccountDataDownload';
afterEach(() => vi.restoreAllMocks());
it('requires a password, exposes no download on failure, and requests only account settings', async () => {
  const fetchMock = vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValue(
      new Response(
        JSON.stringify({ message: 'Current password is incorrect.' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } },
      ),
    );
  render(<AccountDataDownload settingsOnly busy={false} setBusy={vi.fn()} />);
  expect(
    screen.getByRole('button', { name: 'Prepare Download' }),
  ).toBeDisabled();
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('Current Password'), 'test-password');
  await user.click(screen.getByRole('button', { name: 'Prepare Download' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('incorrect');
  expect(screen.queryByRole('link')).not.toBeInTheDocument();
  expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
    currentPassword: 'test-password',
    kind: 'SETTINGS',
  });
});
