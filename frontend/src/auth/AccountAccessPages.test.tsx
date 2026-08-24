import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { DoctorReactivationPage, ForgotPasswordPage, ResetPasswordPage } from './AccountAccessPages';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('F5 staff account access', () => {
  it('keeps password reset request messaging privacy-neutral', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ accepted: true }));
    vi.stubGlobal('fetch', fetchMock);
    render(<MemoryRouter><ForgotPasswordPage /></MemoryRouter>);

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'doctor@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    expect(await screen.findByRole('status')).toHaveTextContent('If the account is eligible');
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/auth/request-password-reset'), expect.objectContaining({ method: 'POST' }));
  });

  it('does not submit a password reset when confirmation differs', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(
      <MemoryRouter initialEntries={['/reset-password?token=reset-token']}>
        <Routes><Route path="/reset-password" element={<ResetPasswordPage />} /></Routes>
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'Example-password-1' } });
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'Different-password-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Change password' }));

    expect(screen.getByRole('alert')).toHaveTextContent('do not match');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends Doctor reactivation with an idempotency key', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ accountStatus: 'ACTIVE' }));
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('crypto', { randomUUID: () => '11111111-1111-4111-8111-111111111111' });
    render(<MemoryRouter><DoctorReactivationPage /></MemoryRouter>);

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'doctor@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'current-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Reactivate account' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const options = fetchMock.mock.calls[0][1] as RequestInit;
    expect(new Headers(options.headers).get('Idempotency-Key')).toBe('11111111-1111-4111-8111-111111111111');
    expect(await screen.findByRole('status')).toHaveTextContent('Account reactivated');
  });
});
