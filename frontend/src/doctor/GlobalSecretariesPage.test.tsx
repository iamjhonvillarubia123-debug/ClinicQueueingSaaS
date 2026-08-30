import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { SecretaryDirectoryView, type SecretaryDirectory } from './GlobalSecretariesPage';

const directory: SecretaryDirectory = { assignments: [{ practiceStaffId: 'staff-1', name: 'Jane Reyes', email: 'jane@example.test', mobileNumber: '0918', clinic: { id: 'clinic-1', name: 'North Clinic' }, operationallyReady: true, isClinicSecretary: true, assignedAt: '2026-08-28T00:00:00Z', substituteCoverages: [] }], pendingInvitations: [{ invitationId: 'invite-1', name: 'Anna Cruz', email: 'anna@example.test', mobileNumber: '0917', clinic: { id: 'clinic-2', name: 'South Clinic' }, status: 'PENDING', invitedAt: '2026-08-29T00:00:00Z' }] };
afterEach(cleanup);
describe('SecretaryDirectoryView', () => {
  it('shows clinic context and only approved role labels', () => { render(<SecretaryDirectoryView data={directory} />); expect(screen.getByText('North Clinic')).toBeInTheDocument(); expect(screen.getByText('Clinic Secretary')).toBeInTheDocument(); expect(screen.queryByText(/Regular Secretary/i)).not.toBeInTheDocument(); });
  it('shows authoritative pending invitations', async () => { const user = userEvent.setup(); render(<SecretaryDirectoryView data={directory} />); await user.click(screen.getByRole('button', { name: 'Pending Invitations (1)' })); expect(screen.getByText('Anna Cruz')).toBeInTheDocument(); expect(screen.getByText('South Clinic')).toBeInTheDocument(); });
});
