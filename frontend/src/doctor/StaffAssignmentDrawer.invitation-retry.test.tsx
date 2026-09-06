import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AuthoritativeClinicStaff } from './AuthoritativeClinicStaffTab';
import { StaffAssignmentDrawer } from './StaffAssignmentDrawer';

const data: AuthoritativeClinicStaff = {
  clinic: { id: 'clinic-1', name: 'North Clinic' },
  candidates: [],
  pendingInvitations: [],
  staffAssignments: [],
};

const missingAccountMessage =
  'No Secretary account was found for this email. Please review the email address for possible errors. If the details are correct, ask the Secretary to create and verify an account first.';

afterEach(cleanup);

describe('StaffAssignmentDrawer invitation retry', () => {
  it('explains that clinic invitations require an existing Secretary account', () => {
    render(
      <StaffAssignmentDrawer
        data={data}
        pending={false}
        message=""
        onClose={() => undefined}
        onSubmit={() => undefined}
      />,
    );

    expect(screen.getByText('Invite Secretary to Clinic')).toBeInTheDocument();
    expect(
      screen.getByText(/existing Secretary account/i),
    ).toBeInTheDocument();
  });

  it('keeps the Doctor on review, exposes only the email for correction, and retries with the corrected address', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();

    render(
      <StaffAssignmentDrawer
        data={data}
        pending={false}
        message={missingAccountMessage}
        onClose={() => undefined}
        onSubmit={onSubmit}
      />,
    );

    await user.click(
      screen.getByRole('button', { name: /Invite New Secretary to Clinic/i }),
    );
    await user.type(screen.getByLabelText('First Name'), 'Anna');
    await user.type(screen.getByLabelText('Last Name'), 'Dela Cruz');
    await user.type(screen.getByLabelText('Email Address'), 'anna@example.ocm');
    await user.type(screen.getByLabelText('Mobile Number'), '09181112222');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('button', { name: 'Next' }));

    expect(
      screen.getByRole('heading', { name: 'Review Invitation' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(
      /review the email address for possible errors/i,
    );
    expect(
      screen.queryByRole('button', { name: 'Send Invitation' }),
    ).not.toBeInTheDocument();

    const correction = screen.getByLabelText('Secretary Email Address');
    expect(correction).toHaveValue('anna@example.ocm');
    await user.clear(correction);
    await user.type(correction, 'anna@example.com');
    await user.click(screen.getByRole('button', { name: 'Retry Invitation' }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        role: 'INVITE_NEW',
        assignmentType: 'CLINIC_SECRETARY',
        email: 'anna@example.com',
        firstName: 'Anna',
        lastName: 'Dela Cruz',
        mobileNumber: '09181112222',
        authorityBundles: ['QUEUE_AND_CLINIC_DAY_OPERATIONS'],
      }),
    );
  });
});
