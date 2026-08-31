import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClinicStaffView, type AuthoritativeClinicStaff } from './AuthoritativeClinicStaffTab';
import { StaffAssignmentDrawer } from './StaffAssignmentDrawer';
import { StaffActionDrawer } from './StaffActionDrawer';

const staff: AuthoritativeClinicStaff = { clinic: { id: 'clinic-1', name: 'North Clinic' }, candidates: [{ userId: 'candidate-1', name: 'Jane Reyes', email: 'jane@example.test', mobileNumber: '09183334444' }], pendingInvitations: [], staffAssignments: [
  { practiceStaffId: 'staff-regular', userId: 'user-regular', name: 'Maria Santos', email: 'maria@example.test', mobileNumber: '09172223333', assignmentActive: true, operationallyReady: true, isClinicSecretary: true, assignmentType: 'CLINIC_SECRETARY', assignedAt: '2026-08-24T10:02:00.000Z', deactivatedAt: null, updatedAt: '2026-08-24T10:02:00.000Z', authorityBundles: ['QUEUE_CLINIC_DAY_OPERATIONS'], previousAuthorityBundles: ['QUEUE_AND_CLINIC_DAY_OPERATIONS'], substituteCoverages: [] },
  { practiceStaffId: 'staff-disabled', userId: 'user-disabled', name: 'Carla Castillo', email: 'carla@example.test', mobileNumber: '09188889999', assignmentActive: false, operationallyReady: false, isClinicSecretary: false, assignmentType: 'CLINIC_SECRETARY', assignedAt: '2026-08-20T08:00:00.000Z', deactivatedAt: '2026-08-25T08:00:00.000Z', updatedAt: '2026-08-25T08:00:00.000Z', authorityBundles: [], previousAuthorityBundles: ['QUEUE_AND_CLINIC_DAY_OPERATIONS'], substituteCoverages: [] },
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
  it('collects an invited Clinic Secretary role, authority, and replacement confirmation', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<StaffAssignmentDrawer data={staff} pending={false} message="" onClose={() => undefined} onSubmit={onSubmit} />);
    await user.click(screen.getByRole('button', { name: /Invite New Secretary/i }));
    await user.type(screen.getByLabelText('First Name'), 'Anna');
    await user.type(screen.getByLabelText('Last Name'), 'Dela Cruz');
    await user.type(screen.getByLabelText('Email Address'), 'anna@example.test');
    await user.type(screen.getByLabelText('Mobile Number'), '09181112222');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByRole('heading', { name: 'Set Assignment Type' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByRole('heading', { name: 'Set Authority Bundles' })).toBeInTheDocument();
    expect(screen.getByText(/will replace Maria Santos/i)).toBeInTheDocument();
    await user.type(screen.getByLabelText(/password/i), 'Doctor password');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('button', { name: 'Send Invitation' }));
    expect(onSubmit).toHaveBeenCalledWith({ role: 'INVITE_NEW', firstName: 'Anna', lastName: 'Dela Cruz', email: 'anna@example.test', mobileNumber: '09181112222', assignmentType: 'CLINIC_SECRETARY', authorityBundles: ['QUEUE_AND_CLINIC_DAY_OPERATIONS'], password: 'Doctor password' });
  });
  it('shows pending invitations in both All and Pending Invitations', async () => {
    const user = userEvent.setup();
    const withInvitation: AuthoritativeClinicStaff = { ...staff, pendingInvitations: [{ invitationId: 'invite-1', name: 'Anna Dela Cruz', email: 'anna@example.test', mobileNumber: '09181112222', status: 'PENDING', assignmentType: 'CLINIC_SECRETARY', authorityBundles: ['QUEUE_AND_CLINIC_DAY_OPERATIONS'], coverageMode: null, fromServiceDate: null, toServiceDate: null, invitedAt: '2026-08-31T10:00:00.000Z', expiresAt: '2026-09-07T10:00:00.000Z' }] };
    render(<ClinicStaffView data={withInvitation} />);
    expect(screen.getByRole('button', { name: 'All (3)' })).toBeInTheDocument();
    expect(screen.getByText('Anna Dela Cruz')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Pending Invitations (1)' }));
    expect(screen.getByText('Anna Dela Cruz')).toBeInTheDocument();
    expect(screen.queryByText('Maria Santos')).not.toBeInTheDocument();
  });
  it('uses clickable pen and trash actions with no three-dot menu', async () => {
    const user = userEvent.setup(); const onEdit = vi.fn(); const onRemove = vi.fn();
    render(<ClinicStaffView data={staff} onEdit={onEdit} onRemove={onRemove} />);
    await user.click(screen.getByRole('button', { name: 'Edit Maria Santos' }));
    await user.click(screen.getByRole('button', { name: 'Remove Maria Santos' }));
    expect(onEdit).toHaveBeenCalledWith(staff.staffAssignments[0]); expect(onRemove).toHaveBeenCalledWith(staff.staffAssignments[0]); expect(screen.queryByRole('button', { name: /More actions/i })).not.toBeInTheDocument();
  });
  it('requires the Doctor password and shows the clinic-only warning before disabling', () => {
    render(<StaffActionDrawer staff={staff.staffAssignments[0]} mode="EDIT" replacementRequired={false} pending={false} message="" clinicName="North Clinic" onClose={() => undefined} onSubmit={() => undefined} />);
    expect(screen.getByText(/account and assignments at other clinics remain unaffected/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/current password/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Disable at this clinic' })).toBeDisabled();
  });
  it('preserves disabled history when the trash action cannot erase an ended assignment', () => {
    render(<StaffActionDrawer staff={staff.staffAssignments[1]} mode="REMOVE" replacementRequired={false} pending={false} message="" clinicName="North Clinic" onClose={() => undefined} onSubmit={() => undefined} />);
    expect(screen.getByText(/retained for required clinic history/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove Assignment' })).not.toBeInTheDocument();
  });
});
