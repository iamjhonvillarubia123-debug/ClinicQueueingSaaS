import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { AccountSecurityPage, PermanentCloseAccountPage, ReactivateAccountPage } from './AccountLifecyclePages';

const clearSessionMock = vi.fn();
const authState = vi.hoisted(() => ({ profile: { userId: 'doctor-1', role: 'DOCTOR' } as { userId: string; role: string } | null }));

vi.mock('./AuthContext', () => ({
  useAuth: () => ({
    profile: authState.profile,
    clearSession: clearSessionMock,
  }),
}));

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

afterEach(() => {
  cleanup();
  authState.profile = { userId: 'doctor-1', role: 'DOCTOR' };
  vi.restoreAllMocks();
  clearSessionMock.mockClear();
});

describe('F5 staff account lifecycle', () => {
  it('requires sign-in and explains reactivation before Secretary closure', () => {
    authState.profile = null;
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    render(<MemoryRouter initialEntries={['/account/permanent-close?role=SECRETARY']}><PermanentCloseAccountPage /></MemoryRouter>);
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login');
    expect(screen.getByRole('link', { name: 'Reactivate account' })).toHaveAttribute('href', '/account/reactivate?role=SECRETARY');
    expect(screen.queryByRole('button', { name: 'Permanently close account' })).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reactivates a mobile-only Secretary with an identifier request', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ reactivated: true }));
    const user = userEvent.setup();
    render(<MemoryRouter initialEntries={['/account/reactivate?role=SECRETARY']}><ReactivateAccountPage /></MemoryRouter>);
    expect(screen.getByLabelText('Sign-in identifier')).toHaveAttribute('type', 'text');
    await user.type(screen.getByLabelText('Sign-in identifier'), '+639171234567');
    await user.type(screen.getByLabelText('Current password'), 'secret-password');
    await user.click(screen.getByRole('button', { name: 'Reactivate account' }));
    expect(await screen.findByRole('heading', { name: 'Account reactivated.' })).toBeInTheDocument();
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({ identifier: '+639171234567', password: 'secret-password' });
    expect(clearSessionMock).not.toHaveBeenCalled();
  });

  it('requires the current password and clears stale auth state after voluntary disablement', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ disabled: true, replayed: false }));
    const user = userEvent.setup();
    render(<MemoryRouter><AccountSecurityPage /></MemoryRouter>);

    await user.click(screen.getByRole('button', { name: 'Disable my account' }));
    const confirmButton = screen.getByRole('button', { name: 'Yes, disable my account' });
    expect(confirmButton).toBeDisabled();

    await user.type(screen.getByLabelText('Current password'), 'secret-password');
    expect(confirmButton).toBeEnabled();
    await user.click(confirmButton);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/doctor/account/disable');
    expect(JSON.parse(String(init?.body))).toEqual({ currentPassword: 'secret-password' });
    expect(new Headers(init?.headers).get('Idempotency-Key')).toBeTruthy();
    expect(clearSessionMock).toHaveBeenCalledTimes(1);
  });

  it('reactivates a disabled Doctor without creating a signed-in session', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ reactivated: true, replayed: false }));
    const user = userEvent.setup();
    render(<MemoryRouter initialEntries={['/account/reactivate?role=DOCTOR']}><ReactivateAccountPage /></MemoryRouter>);

    await user.type(screen.getByLabelText('Sign-in identifier'), 'doctor@example.com');
    await user.type(screen.getByLabelText('Current password'), 'secret-password');
    await user.click(screen.getByRole('button', { name: 'Reactivate account' }));

    expect(await screen.findByRole('heading', { name: 'Account reactivated.' })).toBeInTheDocument();
    expect(screen.getByText(/does not sign you in/i)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/doctor/account/reactivate');
    expect(new Headers(init?.headers).get('Idempotency-Key')).toBeTruthy();
  });

  it('requires an explicit role when reactivation is opened from sign in', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ reactivated: true, replayed: false }));
    const user = userEvent.setup();
    render(<MemoryRouter><ReactivateAccountPage /></MemoryRouter>);

    await user.type(screen.getByLabelText('Sign-in identifier'), 'secretary@example.com');
    await user.type(screen.getByLabelText('Current password'), 'secret-password');
    const reactivateButton = screen.getByRole('button', { name: 'Reactivate account' });
    expect(reactivateButton).toBeDisabled();

    await user.click(screen.getByRole('radio', { name: /Secretary/ }));
    expect(reactivateButton).toBeEnabled();
    await user.click(reactivateButton);

    expect(await screen.findByText(/A Doctor must assign you again/)).toBeInTheDocument();
    expect(String(fetchMock.mock.calls[0][0])).toContain('/secretary/account/reactivate');
  });

  it.each(['secretary@example.com', '+639171234567'])('closes the signed-in Secretary using primary identifier %s', async (identifier) => {
    authState.profile = { userId: 'secretary-1', role: 'SECRETARY' };
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ permanentlyClosed: true }));
    const user = userEvent.setup();
    render(<MemoryRouter initialEntries={['/account/permanent-close?role=SECRETARY']}><PermanentCloseAccountPage /></MemoryRouter>);

    expect(screen.getByLabelText('Sign-in identifier')).toHaveAttribute('type', 'text');
    await user.type(screen.getByLabelText('Sign-in identifier'), identifier);
    await user.type(screen.getByLabelText('Password'), 'secret-password');
    const closeButton = screen.getByRole('button', { name: 'Permanently close account' });
    expect(closeButton).toBeDisabled();

    await user.click(screen.getByRole('checkbox'));
    expect(closeButton).toBeEnabled();
    await user.click(closeButton);

    expect(await screen.findByRole('heading', { name: 'Account permanently closed.' })).toBeInTheDocument();
    expect(clearSessionMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(String(init?.body))).toEqual({ identifier, password: 'secret-password', confirmPermanentDelete: true });
    expect(new Headers(init?.headers).get('Idempotency-Key')).toBeTruthy();
  });

  it.each(['DOCTOR', 'SECRETARY'])('explains invalid %s closure credentials without revealing which credential failed', async (role) => {
    authState.profile = { userId: 'owner-1', role };
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ message: 'Unable to permanently close account.' }, 401));
    const user = userEvent.setup();
    render(<MemoryRouter initialEntries={[`/account/permanent-close?role=${role}`]}><PermanentCloseAccountPage /></MemoryRouter>);

    await user.type(screen.getByLabelText('Sign-in identifier'), 'doctor@example.com');
    await user.type(screen.getByLabelText('Password'), 'wrong-password');
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Permanently close account' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Sign-in identifier or current password is incorrect.');
    expect(screen.queryByRole('heading', { name: 'Account permanently closed.' })).not.toBeInTheDocument();
    expect(clearSessionMock).not.toHaveBeenCalled();
  });
});


describe('Secretary account actions', () => {
  it('offers password change and opens role-free permanent closure in a drawer', async () => {
    authState.profile = { userId: 'secretary-1', role: 'SECRETARY' };
    Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value() { this.setAttribute('open', ''); } });
    render(<MemoryRouter><AccountSecurityPage /></MemoryRouter>);
    expect(screen.getByRole('button', { name: 'Change Password' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Reset password' })).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Review permanent closure' }));
    expect(screen.getByRole('dialog', { name: 'Permanent account closure' })).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Sign-in identifier')).toHaveAttribute('type', 'text');
  });
});


it.each([200, 401])('changes the Secretary password in settings and handles response %s', async (status) => {
  authState.profile = { userId: 'secretary-1', role: 'SECRETARY' };
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value() { this.setAttribute('open', ''); } });
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(status === 200 ? { changed: true } : { message: 'Current password is incorrect.' }, status));
  const user = userEvent.setup();
  render(<MemoryRouter initialEntries={['/app/account']}><AccountSecurityPage /></MemoryRouter>);
  await user.click(screen.getByRole('button', { name: 'Change Password' }));
  expect(screen.getByRole('dialog', { name: 'Change Password' })).toBeInTheDocument();
  expect(screen.queryByText('Send reset link')).not.toBeInTheDocument();
  const submit = screen.getByRole('button', { name: 'Update Password' });
  expect(submit).toBeDisabled();
  await user.type(screen.getByLabelText('Current Password'), 'current-password');
  await user.type(screen.getByLabelText('New Password'), 'A fresh long passphrase 42!');
  await user.type(screen.getByLabelText('Confirm New Password'), 'different');
  expect(submit).toBeDisabled();
  await user.clear(screen.getByLabelText('Confirm New Password'));
  await user.type(screen.getByLabelText('Confirm New Password'), 'A fresh long passphrase 42!');
  await user.click(submit);
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  expect(String(fetchMock.mock.calls[0][0])).toContain('/auth/account/change-password');
  expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({ currentPassword: 'current-password', newPassword: 'A fresh long passphrase 42!', confirmNewPassword: 'A fresh long passphrase 42!' });
  if (status === 200) expect(clearSessionMock).toHaveBeenCalledTimes(1);
  else {
    expect(await screen.findByRole('alert')).toHaveTextContent('Current password is incorrect.');
    expect(clearSessionMock).not.toHaveBeenCalled();
    expect(submit).toBeEnabled();
  }
});
