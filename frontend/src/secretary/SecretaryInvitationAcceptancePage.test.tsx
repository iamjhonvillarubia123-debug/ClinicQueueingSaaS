import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SecretaryInvitationAcceptancePage } from './SecretaryInvitationAcceptancePage';

const auth = vi.hoisted(() => ({
  status: 'anonymous' as 'anonymous' | 'authenticated',
  profile: null as null | { userId: string; role: 'SECRETARY' | 'DOCTOR' },
}));
vi.mock('../auth/AuthContext', () => ({ useAuth: () => auth }));
afterEach(() => {
  vi.restoreAllMocks();
  auth.status = 'anonymous';
  auth.profile = null;
});
const preview = () =>
  new Response(
    JSON.stringify({
      status: 'PENDING',
      name: 'Anna Cruz',
      email: 'anna@example.test',
      clinicName: 'North Clinic',
      expiresAt: '2026-09-07T00:00:00Z',
      assignmentType: 'CLINIC_SECRETARY',
      authorityBundles: ['QUEUE_AND_CLINIC_DAY_OPERATIONS'],
      requestedCancelClinicDay: false,
      coverageMode: null,
      fromServiceDate: null,
      toServiceDate: null,
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );

describe('SecretaryInvitationAcceptancePage', () => {
  it('shows cancellation and does not offer acceptance for a revoked invitation', async () => {
    auth.status = 'authenticated';
    auth.profile = { userId: 'secretary-1', role: 'SECRETARY' };
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ status: 'CANCELLED' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    render(
      <MemoryRouter
        initialEntries={['/secretary-invitations/accept?token=cancelled-token']}
      >
        <SecretaryInvitationAcceptancePage />
      </MemoryRouter>,
    );
    expect(
      await screen.findByRole('heading', { name: 'Invitation Cancelled' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/can no longer be accepted/i)).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Accept Invitation' }),
    ).not.toBeInTheDocument();
  });

  it('explains that an unsigned invitee must create an account or sign in without password controls', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(preview());
    render(
      <MemoryRouter
        initialEntries={['/secretary-invitations/accept?token=valid-token']}
      >
        <SecretaryInvitationAcceptancePage />
      </MemoryRouter>,
    );
    expect(
      await screen.findByText(/does not create your account/i),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sign In' })).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Create Secretary Account' }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument();
  });

  it('lets a signed-in Secretary accept only the clinic relationship', async () => {
    auth.status = 'authenticated';
    auth.profile = { userId: 'secretary-1', role: 'SECRETARY' };
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(preview())
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ accepted: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    const user = userEvent.setup();
    render(
      <MemoryRouter
        initialEntries={['/secretary-invitations/accept?token=valid-token']}
      >
        <SecretaryInvitationAcceptancePage />
      </MemoryRouter>,
    );
    await user.click(
      await screen.findByRole('button', { name: 'Accept Invitation' }),
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[1][1]?.body).toBe(
      JSON.stringify({ token: 'valid-token' }),
    );
    expect(
      await screen.findByRole('heading', {
        name: 'Clinic Assignment Accepted',
      }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Account Created/i)).not.toBeInTheDocument();
  });

  it('blocks an incompatible signed-in role in the UI', async () => {
    auth.status = 'authenticated';
    auth.profile = { userId: 'doctor-1', role: 'DOCTOR' };
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(preview());
    render(
      <MemoryRouter
        initialEntries={['/secretary-invitations/accept?token=valid-token']}
      >
        <SecretaryInvitationAcceptancePage />
      </MemoryRouter>,
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /only be accepted while signed in as a Secretary/i,
    );
  });
});
