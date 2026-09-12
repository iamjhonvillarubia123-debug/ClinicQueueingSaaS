import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PendingInvitationActionDrawer } from './PendingInvitationActionDrawer';
import type { PendingStaffInvitation } from './AuthoritativeClinicStaffTab';

afterEach(cleanup);
const invitation: PendingStaffInvitation = {
  invitationId: 'mobile-invitation', name: 'Test Secretary', email: null, mobileNumber: '+639171234567', status: 'PENDING', assignmentType: 'CLINIC_SECRETARY', authorityBundles: ['QUEUE_AND_CLINIC_DAY_OPERATIONS'], coverageMode: null, fromServiceDate: null, toServiceDate: null, invitedAt: '2026-09-11', expiresAt: '2099-01-01',
};
describe('Mobile invitation actions', () => {
  it('opens removal after an unsuccessful acceptance without requiring an email', async () => {
    const onSubmit = vi.fn();
    render(<PendingInvitationActionDrawer invitation={invitation} mode="REMOVE" clinicName="Test Clinic" pending={false} message="" onClose={vi.fn()} onSubmit={onSubmit} />);
    await userEvent.setup().click(screen.getByRole('button', { name: /Cancel Invitation/i }));
    expect(onSubmit).toHaveBeenCalledWith({ type: 'REMOVE' });
  });
  it('allows editing the mobile identifier as text', () => {
    render(<PendingInvitationActionDrawer invitation={invitation} mode="EDIT" clinicName="Test Clinic" pending={false} message="" onClose={vi.fn()} onSubmit={vi.fn()} />);
    expect(screen.getByLabelText('Secretary Email or Mobile Number')).toHaveValue(invitation.mobileNumber);
    expect(screen.getByLabelText('Secretary Email or Mobile Number')).toHaveAttribute('type', 'text');
  });
});
