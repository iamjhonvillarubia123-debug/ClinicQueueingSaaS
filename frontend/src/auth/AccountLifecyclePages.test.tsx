import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { AccountSecurityPage, PermanentCloseAccountPage, ReactivateAccountPage } from './AccountLifecyclePages';

const clearSessionMock = vi.fn();

vi.mock('./AuthContext', () => ({
  useAuth: () => ({
    profile: { userId: 'doctor-1', role: 'DOCTOR' },
    clearSession: clearSessionMock,
  }),
}));

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  clearSessionMock.mockClear();
});

describe('F5 staff account lifecycle', () => {
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

    await user.type(screen.getByLabelText('Email address'), 'doctor@example.com');
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

    await user.type(screen.getByLabelText('Email address'), 'secretary@example.com');
    await user.type(screen.getByLabelText('Current password'), 'secret-password');
    const reactivateButton = screen.getByRole('button', { name: 'Reactivate account' });
    expect(reactivateButton).toBeDisabled();

    await user.click(screen.getByRole('radio', { name: /Secretary/ }));
    expect(reactivateButton).toBeEnabled();
    await user.click(reactivateButton);

    expect(await screen.findByText(/A Doctor must assign you again/)).toBeInTheDocument();
    expect(String(fetchMock.mock.calls[0][0])).toContain('/secretary/account/reactivate');
  });

  it('requires explicit irreversible confirmation and clears stale auth state after permanent closure', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ permanentlyClosed: true }));
    const user = userEvent.setup();
    render(<MemoryRouter initialEntries={['/account/permanent-close?role=SECRETARY']}><PermanentCloseAccountPage /></MemoryRouter>);

    await user.type(screen.getByLabelText('Email'), 'secretary@example.com');
    await user.type(screen.getByLabelText('Password'), 'secret-password');
    const closeButton = screen.getByRole('button', { name: 'Permanently close account' });
    expect(closeButton).toBeDisabled();

    await user.click(screen.getByRole('checkbox'));
    expect(closeButton).toBeEnabled();
    await user.click(closeButton);

    expect(await screen.findByRole('heading', { name: 'Account permanently closed.' })).toBeInTheDocument();
    expect(clearSessionMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(String(init?.body))).toEqual(expect.objectContaining({ confirmPermanentDelete: true }));
    expect(new Headers(init?.headers).get('Idempotency-Key')).toBeTruthy();
  });

  it('explains invalid permanent-closure credentials without revealing which credential failed', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ message: 'Unable to permanently close account.' }, 401));
    const user = userEvent.setup();
    render(<MemoryRouter initialEntries={['/account/permanent-close?role=DOCTOR']}><PermanentCloseAccountPage /></MemoryRouter>);

    await user.type(screen.getByLabelText('Email'), 'doctor@example.com');
    await user.type(screen.getByLabelText('Password'), 'wrong-password');
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Permanently close account' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Email or current password is incorrect.');
    expect(screen.queryByRole('heading', { name: 'Account permanently closed.' })).not.toBeInTheDocument();
    expect(clearSessionMock).not.toHaveBeenCalled();
  });
});
