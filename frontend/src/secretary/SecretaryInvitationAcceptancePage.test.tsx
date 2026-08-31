import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SecretaryInvitationAcceptancePage } from './SecretaryInvitationAcceptancePage';

afterEach(() => vi.restoreAllMocks());
const preview = () => new Response(JSON.stringify({ name: 'Anna Cruz', email: 'anna@example.test', clinicName: 'North Clinic', expiresAt: '2026-09-03T00:00:00Z' }), { status: 200, headers: { 'content-type': 'application/json' } });
describe('SecretaryInvitationAcceptancePage', () => {
  it('lets the invited Secretary choose their own password and explains the clinic assignment', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(preview()).mockResolvedValueOnce(new Response(JSON.stringify({ accepted: true }), { status: 200, headers: { 'content-type': 'application/json' } })); const user = userEvent.setup();
    render(<MemoryRouter initialEntries={['/secretary-invitations/accept?token=valid-token']}><SecretaryInvitationAcceptancePage /></MemoryRouter>); expect(await screen.findByText(/invited to join/i)).toBeInTheDocument(); expect(screen.getByText(/creates your Secretary account and clinic assignment/i)).toBeInTheDocument(); await user.type(screen.getByLabelText('Create Password'), 'Secretary password'); await user.type(screen.getByLabelText('Confirm Password'), 'Secretary password'); await user.click(screen.getByRole('button', { name: 'Create Secretary Account' })); await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2)); expect(fetchMock.mock.calls[1][1]?.body).toBe(JSON.stringify({ token: 'valid-token', password: 'Secretary password' })); expect(await screen.findByRole('heading', { name: 'Account Created' })).toBeInTheDocument(); expect(screen.getByText(/account and clinic assignment are ready/i)).toBeInTheDocument();
  });
  it('rejects mismatched passwords before calling acceptance', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(preview()); const user = userEvent.setup(); render(<MemoryRouter initialEntries={['/secretary-invitations/accept?token=valid-token']}><SecretaryInvitationAcceptancePage /></MemoryRouter>); await screen.findByText(/invited to join/i); await user.type(screen.getByLabelText('Create Password'), 'one'); await user.type(screen.getByLabelText('Confirm Password'), 'two'); await user.click(screen.getByRole('button', { name: 'Create Secretary Account' })); expect(screen.getByRole('alert')).toHaveTextContent('Passwords do not match.'); expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
