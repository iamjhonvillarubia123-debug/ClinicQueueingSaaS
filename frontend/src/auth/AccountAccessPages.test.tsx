import { StrictMode } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { DoctorRegistrationPage, VerifyEmailPage } from './AccountAccessPages';
import { ForgotPasswordPage, ResetPasswordPage } from './PasswordRecoveryPages';

const refreshMock = vi.fn().mockResolvedValue(undefined);
vi.mock('./AuthContext', () => ({ useAuth: () => ({ refresh: refreshMock }) }));

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  refreshMock.mockClear();
});

describe('F6 account access journeys', () => {
  it('registers a Doctor through the legacy route and moves to the email-verification gate without creating a session', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({
      userId: 'user-1',
      doctorProfileId: 'doctor-1',
      emailVerificationRequired: true,
      emailVerificationExpiresAt: '2026-08-23T04:00:00.000Z',
    }));
    const user = userEvent.setup();

    render(
      <MemoryRouter initialEntries={['/register/doctor']}>
        <Routes>
          <Route path="/register/doctor" element={<DoctorRegistrationPage />} />
          <Route path="/verify-email" element={<div>Email verification destination</div>} />
        </Routes>
      </MemoryRouter>,
    );

    await user.type(screen.getByLabelText('First name'), 'Ana');
    await user.type(screen.getByLabelText('Last name'), 'Santos');
    await user.type(screen.getByLabelText('Email'), 'Doctor@Example.COM');
    await user.type(screen.getByLabelText('Mobile number'), '+639171234567');
    await user.type(screen.getByLabelText('Professional title'), 'Dr.');
    await user.type(screen.getByLabelText('Specialization'), 'Family Medicine');
    await user.type(screen.getByLabelText('Professional license number'), 'PRC-123');
    await user.type(screen.getByLabelText('Password'), 'secret pass');
    await user.type(screen.getByLabelText('Confirm password'), 'secret pass');
    await user.click(screen.getByRole('button', { name: 'Create doctor account' }));

    expect(await screen.findByText('Email verification destination')).toBeInTheDocument();
    const [, init] = fetchMock.mock.calls[0];
    expect(String(fetchMock.mock.calls[0][0])).toContain('/doctor/register');
    expect(init?.method).toBe('POST');
    expect(String(init?.body)).toContain('Doctor@Example.COM');
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/auth/login'))).toBe(false);
  });

  it('keeps password-reset request wording non-enumerating after success', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ accepted: true }));
    const user = userEvent.setup();

    render(<MemoryRouter><ForgotPasswordPage /></MemoryRouter>);
    await user.type(screen.getByLabelText('Email address'), 'unknown@example.com');
    await user.click(screen.getByRole('button', { name: 'Send reset link' }));

    expect(await screen.findByRole('heading', { name: 'Check your email' })).toBeInTheDocument();
    expect(screen.getByText('unknown@example.com')).toBeInTheDocument();
    expect(screen.queryByText(/account exists/i)).not.toBeInTheDocument();
  });

  it('consumes an email-verification token and moves to the approved role-specific ready state', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ verified: true, role: 'SECRETARY' }));

    render(
      <StrictMode>
        <MemoryRouter initialEntries={['/verify-email?token=verify-token']}>
          <Routes>
            <Route path="/verify-email" element={<VerifyEmailPage />} />
            <Route path="/registration/account-ready" element={<div>Account ready destination</div>} />
          </Routes>
        </MemoryRouter>
      </StrictMode>,
    );

    expect(await screen.findByText('Account ready destination')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(refreshMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][1]?.body)).toContain('verify-token');
  });

  it('requires matching new passwords before consuming a reset token', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ reset: true }));
    const user = userEvent.setup();

    render(
      <MemoryRouter initialEntries={['/reset-password?token=reset-token']}>
        <Routes><Route path="/reset-password" element={<ResetPasswordPage />} /></Routes>
      </MemoryRouter>,
    );

    await user.type(screen.getByLabelText('New password'), 'Valid1!Password');
    await user.type(screen.getByLabelText('Confirm new password'), 'Valid2!Password');

    expect(screen.getByRole('alert')).toHaveTextContent('Passwords do not match.');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('consumes a valid reset token and shows the approved completion state', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ reset: true }));
    const user = userEvent.setup();

    render(
      <MemoryRouter initialEntries={['/reset-password?token=reset-token']}>
        <Routes><Route path="/reset-password" element={<ResetPasswordPage />} /></Routes>
      </MemoryRouter>,
    );

    await user.type(screen.getByLabelText('New password'), 'Valid1!Password');
    await user.type(screen.getByLabelText('Confirm new password'), 'Valid1!Password');
    await user.click(screen.getByRole('button', { name: 'Update password' }));

    expect(await screen.findByRole('heading', { name: 'Password updated!' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to sign in' })).toHaveAttribute('href', '/login');
    expect(String(fetchMock.mock.calls[0][1]?.body)).toContain('reset-token');
  });
});
