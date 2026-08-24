import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { SecretaryInvitationPage } from './SecretaryInvitationPage';

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

describe('Secretary invitation onboarding', () => {
  it('inspects the bearer token without exposing it and accepts with the Secretary chosen password', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        jsonResponse({
          valid: true,
          firstName: 'Bea',
          clinicName: 'North Clinic',
          expiresAt: '2026-08-27T04:00:00.000Z',
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ accepted: true }));
    const user = userEvent.setup();

    render(
      <MemoryRouter initialEntries={['/secretary-invitation?token=invite-secret']}>
        <Routes><Route path="/secretary-invitation" element={<SecretaryInvitationPage />} /></Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText(/you were invited to join/)).toBeInTheDocument();
    expect(screen.queryByText('invite-secret')).not.toBeInTheDocument();

    await user.type(screen.getByLabelText('Password'), 'secret pass');
    await user.type(screen.getByLabelText('Confirm password'), 'secret pass');
    await user.click(screen.getByRole('button', { name: 'Accept invitation' }));

    expect(await screen.findByRole('heading', { name: 'Account ready' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Continue to sign in' })).toHaveAttribute('href', '/login');
    expect(String(fetchMock.mock.calls[0][0])).toContain('/secretary/invitations/inspect');
    expect(String(fetchMock.mock.calls[1][0])).toContain('/secretary/invitations/accept');
    expect(String(fetchMock.mock.calls[1][1]?.body)).toContain('invite-secret');
  });

  it('does not submit acceptance when passwords differ', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        jsonResponse({
          valid: true,
          firstName: 'Bea',
          clinicName: 'North Clinic',
          expiresAt: '2026-08-27T04:00:00.000Z',
        }),
      );
    const user = userEvent.setup();

    render(
      <MemoryRouter initialEntries={['/secretary-invitation?token=invite-secret']}>
        <Routes><Route path="/secretary-invitation" element={<SecretaryInvitationPage />} /></Routes>
      </MemoryRouter>,
    );
    await screen.findByText(/you were invited to join/);
    await user.type(screen.getByLabelText('Password'), 'one');
    await user.type(screen.getByLabelText('Confirm password'), 'two');
    await user.click(screen.getByRole('button', { name: 'Accept invitation' }));

    expect(screen.getByRole('alert')).toHaveTextContent('Passwords do not match.');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
