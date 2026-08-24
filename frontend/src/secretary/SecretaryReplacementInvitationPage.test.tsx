import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { SecretaryReplacementInvitationPage } from './SecretaryReplacementInvitationPage';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('Secretary replacement candidate onboarding', () => {
  it('makes clear that account creation does not transfer clinic authority', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({
        valid: true,
        firstName: 'Ana',
        clinicName: 'North Clinic',
        expiresAt: '2026-08-27T04:00:00.000Z',
        accessProfile: 'CUSTOM',
      }))
      .mockResolvedValueOnce(jsonResponse({ accepted: true, assignmentPendingDoctorConfirmation: true }));
    const user = userEvent.setup();

    render(
      <MemoryRouter initialEntries={['/secretary-replacement-invitation?token=replacement-secret']}>
        <Routes><Route path="/secretary-replacement-invitation" element={<SecretaryReplacementInvitationPage />} /></Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText(/does not give you access to that clinic/i)).toBeInTheDocument();
    expect(screen.queryByText('replacement-secret')).not.toBeInTheDocument();
    await user.type(screen.getByLabelText('Password'), 'replacement pass');
    await user.type(screen.getByLabelText('Confirm password'), 'replacement pass');
    await user.click(screen.getByRole('button', { name: 'Create Secretary account' }));

    expect(await screen.findByRole('heading', { name: 'Account ready for Doctor confirmation' })).toBeInTheDocument();
    expect(screen.getByText(/current Secretary still controls the clinic/i)).toBeInTheDocument();
    expect(String(fetchMock.mock.calls[0][0])).toContain('/secretary/replacement-invitations/inspect');
    expect(String(fetchMock.mock.calls[1][0])).toContain('/secretary/replacement-invitations/accept');
  });
});
