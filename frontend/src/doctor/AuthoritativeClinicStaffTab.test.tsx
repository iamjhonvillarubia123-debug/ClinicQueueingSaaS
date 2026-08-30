import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClinicStaffView, type AuthoritativeClinicStaff } from './AuthoritativeClinicStaffTab';
import { StaffAssignmentDrawer } from './StaffAssignmentDrawer';

const staff: AuthoritativeClinicStaff = { clinic: { id: 'clinic-1', name: 'North Clinic' }, candidates: [{ userId: 'candidate-1', name: 'Jane Reyes', email: 'jane@example.test', mobileNumber: '09183334444' }], pendingInvitations: [], staffAssignments: [
  { practiceStaffId: 'staff-regular', userId: 'user-regular', name: 'Maria Santos', email: 'maria@example.test', mobileNumber: '09172223333', assignmentActive: true, operationallyReady: true, isClinicSecretary: true, assignedAt: '2026-08-24T10:02:00.000Z', deactivatedAt: null, updatedAt: '2026-08-24T10:02:00.000Z', authorityBundles: ['QUEUE_CLINIC_DAY_OPERATIONS'], substituteCoverages: [] },
  { practiceStaffId: 'staff-disabled', userId: 'user-disabled', name: 'Carla Castillo', email: 'carla@example.test', mobileNumber: '09188889999', assignmentActive: false, operationallyReady: false, isClinicSecretary: false, assignedAt: '2026-08-20T08:00:00.000Z', deactivatedAt: '2026-08-25T08:00:00.000Z', updatedAt: '2026-08-25T08:00:00.000Z', authorityBundles: [], substituteCoverages: [] },
] };
afterEach(cleanup);

describe('ClinicStaffView', () => {
  it('renders the approved clinic Staff directory without date-scoped controls', () => {
    render(<ClinicStaffView data={staff} />);
    expect(screen.getByRole('heading', { name: 'Staff' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /assign secretary/i })).toBeInTheDocument();
    expect(screen.getAllByText('Clinic Secretary').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Disabled (at this clinic)').length).toBeGreaterThan(0);
    expect(screen.queryByText(/Secretary for the Day/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Service Date/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
  });
  it('filters active, disabled, and pending states', async () => {
    const user = userEvent.setup(); render(<ClinicStaffView data={staff} />);
    await user.click(screen.getByRole('button', { name: 'Active (1)' })); expect(screen.getByText('Maria Santos')).toBeInTheDocument(); expect(screen.queryByText('Carla Castillo')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Disabled (1)' })); expect(screen.getByText('Carla Castillo')).toBeInTheDocument(); expect(screen.queryByText('Maria Santos')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Pending Invitations (0)' })); expect(screen.getByText('No pending invitations.')).toBeInTheDocument();
  });
  it('uses only the approved role labels', () => {
    render(<ClinicStaffView data={staff} />);
    expect(screen.queryByText(/Regular Secretary/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Operating Secretary/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Clinic Secretary \(Regular\)/i)).not.toBeInTheDocument();
  });
  it('keeps substitute coverage date-based and separate from authority bundles', async () => {
    const user = userEvent.setup();
    render(<StaffAssignmentDrawer data={staff} pending={false} message="" onClose={() => undefined} onSubmit={() => undefined} />);
    await user.click(screen.getByRole('button', { name: /Assign Existing Secretary/i }));
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('button', { name: /Substitute Secretary/i }));
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByRole('heading', { name: 'Substitute Secretary Coverage' })).toBeInTheDocument();
    expect(screen.getByText(/Authority is limited to live clinic and queue operations/i)).toBeInTheDocument();
    expect(screen.queryByText('Set Authority Bundles')).not.toBeInTheDocument();
    expect(screen.queryByText(/Cancel Clinic Day/i)).not.toBeInTheDocument();
  });
  it('collects invitation details without asking the Doctor for a password', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<StaffAssignmentDrawer data={staff} pending={false} message="" onClose={() => undefined} onSubmit={onSubmit} />);
    await user.click(screen.getByRole('button', { name: /Invite New Secretary/i }));
    await user.type(screen.getByLabelText('First Name'), 'Anna');
    await user.type(screen.getByLabelText('Last Name'), 'Dela Cruz');
    await user.type(screen.getByLabelText('Email Address'), 'anna@example.test');
    await user.type(screen.getByLabelText('Mobile Number'), '09181112222');
    expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Send Invitation' }));
    expect(onSubmit).toHaveBeenCalledWith({ role: 'INVITE_NEW', firstName: 'Anna', lastName: 'Dela Cruz', email: 'anna@example.test', mobileNumber: '09181112222' });
  });
});
