import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import {
  AccountRegistrationPage,
  ForgotPasswordPage,
  ResetPasswordPage,
  VerifyEmailPage,
} from './AccountAccessPages';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('F5 account access journeys', () => {
  it('registers a Doctor and moves to the email-verification gate without creating a session', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({
        userId: 'user-1',
        doctorProfileId: 'doctor-1',
        emailVerificationRequired: true,
        emailVerificationExpiresAt: '2026-08-23T04:00:00.000Z',
      }),
    );
    const user = userEvent.setup();

    render(
      <MemoryRouter initialEntries={['/register']}>
        <Routes>
          <Route path="/register" element={<AccountRegistrationPage />} />
          <Route
            path="/verify-email"
            element={<div>Email verification destination</div>}
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByRole('option', { name: 'Doctor' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Secretary' })).toBeInTheDocument();
    expect(
      screen.queryByRole('option', { name: /system admin/i }),
    ).not.toBeInTheDocument();

    await user.type(screen.getByLabelText('First name'), 'Ana');
    await user.type(screen.getByLabelText('Last name'), 'Santos');
    await user.type(screen.getByLabelText('Email'), 'Doctor@Example.COM');
    await user.type(screen.getByLabelText('Mobile number'), '+639171234567');
    await user.type(screen.getByLabelText('Professional title'), 'Dr.');
    await user.type(screen.getByLabelText('Specialization'), 'Family Medicine');
    await user.type(screen.getByLabelText('Professional license number'), 'PRC-123');
    await user.type(screen.getByLabelText('Password'), 'secret pass');
    await user.type(screen.getByLabelText('Confirm password'), 'secret pass');
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    expect(
      await screen.findByText('Email verification destination'),
    ).toBeInTheDocument();
    const [, init] = fetchMock.mock.calls[0];
    expect(String(fetchMock.mock.calls[0][0])).toContain('/doctor/register');
    expect(init?.method).toBe('POST');
    expect(String(init?.body)).toContain('Doctor@Example.COM');
    expect(
      fetchMock.mock.calls.some(([input]) =>
        String(input).includes('/auth/login'),
      ),
    ).toBe(false);
  });

  it('registers a Secretary without Doctor-only professional fields', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({
        userId: 'secretary-user-1',
        role: 'SECRETARY',
        emailVerificationRequired: true,
        emailVerificationExpiresAt: '2026-08-23T04:00:00.000Z',
      }),
    );
    const user = userEvent.setup();

    render(
      <MemoryRouter initialEntries={['/register']}>
        <Routes>
          <Route path="/register" element={<AccountRegistrationPage />} />
          <Route
            path="/verify-email"
            element={<div>Email verification destination</div>}
          />
        </Routes>
      </MemoryRouter>,
    );

    await user.selectOptions(screen.getByLabelText('Account type'), 'SECRETARY');
    expect(screen.queryByLabelText('Professional title')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Specialization')).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText('Professional license number'),
    ).not.toBeInTheDocument();

    await user.type(screen.getByLabelText('First name'), 'Bea');
    await user.type(screen.getByLabelText('Last name'), 'Cruz');
    await user.type(screen.getByLabelText('Email'), 'secretary@example.com');
    await user.type(screen.getByLabelText('Mobile number'), '+639181234567');
    await user.type(screen.getByLabelText('Password'), 'secret pass');
    await user.type(screen.getByLabelText('Confirm password'), 'secret pass');
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    expect(
      await screen.findByText('Email verification destination'),
    ).toBeInTheDocument();
    const [input, init] = fetchMock.mock.calls[0];
    expect(String(input)).toContain('/secretary/register');
    expect(init?.method).toBe('POST');
    expect(String(init?.body)).toContain('secretary@example.com');
    expect(String(init?.body)).not.toContain('professionalTitle');
    expect(
      fetchMock.mock.calls.some(([request]) =>
        String(request).includes('/auth/login'),
      ),
    ).toBe(false);
  });

  it('keeps password-reset request wording non-enumerating after success', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ accepted: true }),
    );
    const user = userEvent.setup();

    render(
      <MemoryRouter>
        <ForgotPasswordPage />
      </MemoryRouter>,
    );
    await user.type(screen.getByLabelText('Email'), 'unknown@example.com');
    await user.click(screen.getByRole('button', { name: 'Send reset link' }));

    expect(
      await screen.findByText(/If an eligible account uses that email/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/account exists/i)).not.toBeInTheDocument();
  });

  it('consumes an email-verification token from the link and offers sign in', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse({ verified: true }));

    render(
      <MemoryRouter initialEntries={['/verify-email?token=verify-token']}>
        <Routes>
          <Route path="/verify-email" element={<VerifyEmailPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(
      await screen.findByRole('heading', { name: 'Email verified' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Continue to sign in' }),
    ).toHaveAttribute('href', '/login');
    expect(String(fetchMock.mock.calls[0][1]?.body)).toContain('verify-token');
  });

  it('requires matching new passwords before consuming a reset token', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse({ reset: true }));
    const user = userEvent.setup();

    render(
      <MemoryRouter initialEntries={['/reset-password?token=reset-token']}>
        <Routes>
          <Route path="/reset-password" element={<ResetPasswordPage />} />
        </Routes>
      </MemoryRouter>,
    );

    await user.type(screen.getByLabelText('New password'), 'one');
    await user.type(screen.getByLabelText('Confirm new password'), 'two');
    await user.click(screen.getByRole('button', { name: 'Change password' }));

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Passwords do not match.',
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
