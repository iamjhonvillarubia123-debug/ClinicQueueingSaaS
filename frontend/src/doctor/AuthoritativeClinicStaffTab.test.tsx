import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ClinicStaffView,
  type AuthoritativeClinicStaff,
} from './AuthoritativeClinicStaffTab';
import { StaffAssignmentDrawer } from './StaffAssignmentDrawer';
import { StaffActionDrawer } from './StaffActionDrawer';

const staff: AuthoritativeClinicStaff = {
  clinic: { id: 'clinic-1', name: 'North Clinic' },
  candidates: [
    {
      userId: 'candidate-1',
      name: 'Jane Reyes',
      email: 'jane@example.test',
      mobileNumber: '09183334444',
    },
  ],
  pendingInvitations: [],
  staffAssignments: [
    {
      practiceStaffId: 'staff-regular',
      userId: 'user-regular',
      name: 'Maria Santos',
      email: 'maria@example.test',
      mobileNumber: '09172223333',
      assignmentActive: true,
      operationallyReady: true,
      isClinicSecretary: true,
      assignmentType: 'CLINIC_SECRETARY',
      assignedAt: '2026-08-24T10:02:00.000Z',
      deactivatedAt: null,
      updatedAt: '2026-08-24T10:02:00.000Z',
      authorityBundles: ['QUEUE_AND_CLINIC_DAY_OPERATIONS'],
      previousAuthorityBundles: ['QUEUE_AND_CLINIC_DAY_OPERATIONS'],
      substituteCoverages: [],
    },
    {
      practiceStaffId: 'staff-disabled',
      userId: 'user-disabled',
      name: 'Carla Castillo',
      email: 'carla@example.test',
      mobileNumber: '09188889999',
      assignmentActive: false,
      operationallyReady: false,
      isClinicSecretary: false,
      assignmentType: 'CLINIC_SECRETARY',
      assignedAt: '2026-08-20T08:00:00.000Z',
      deactivatedAt: '2026-08-25T08:00:00.000Z',
      updatedAt: '2026-08-25T08:00:00.000Z',
      authorityBundles: [],
      previousAuthorityBundles: ['QUEUE_AND_CLINIC_DAY_OPERATIONS'],
      substituteCoverages: [],
    },
  ],
};
Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value() { this.setAttribute('open', ''); } });
afterEach(cleanup);

describe('ClinicStaffView', () => {
  it('renders the approved clinic Staff directory without date-scoped controls', () => {
    render(<ClinicStaffView data={staff} />);
    expect(screen.getByRole('heading', { name: 'Staff' })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /assign secretary/i }),
    ).toBeInTheDocument();
    expect(screen.getAllByText('Clinic Secretary').length).toBeGreaterThan(0);
    expect(
      screen.getAllByText('Disabled (at this clinic)').length,
    ).toBeGreaterThan(0);
    expect(
      screen.queryByText(/Secretary for the Day/i),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/Service Date/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
  });
  it('filters active, disabled, and pending states', async () => {
    const user = userEvent.setup();
    render(<ClinicStaffView data={staff} />);
    await user.click(screen.getByRole('button', { name: 'Active (1)' }));
    expect(screen.getByText('Maria Santos')).toBeInTheDocument();
    expect(screen.queryByText('Carla Castillo')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Disabled (1)' }));
    expect(screen.getByText('Carla Castillo')).toBeInTheDocument();
    expect(screen.queryByText('Maria Santos')).not.toBeInTheDocument();
    await user.click(
      screen.getByRole('button', { name: 'Pending Invitations (0)' }),
    );
    expect(screen.getByText('No pending invitations.')).toBeInTheDocument();
  });
  it('shows a pending invitation in All and Pending, but not Active or Disabled', async () => {
    const user = userEvent.setup();
    const withPending: AuthoritativeClinicStaff = {
      ...staff,
      pendingInvitations: [
        {
          invitationId: 'invite-1',
          name: 'Anna Cruz',
          email: 'anna@example.test',
          mobileNumber: '0917',
          status: 'PENDING',
          assignmentType: 'SUBSTITUTE_SECRETARY',
          authorityBundles: [],
          coverageMode: 'ONE_SERVICE_DATE',
          fromServiceDate: '2026-09-02',
          toServiceDate: '2026-09-02',
          invitedAt: '2026-08-31T00:00:00Z',
          expiresAt: '2026-09-07T00:00:00Z',
        },
      ],
    };
    render(<ClinicStaffView data={withPending} />);
    expect(screen.getByText('Anna Cruz')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'All (3)' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Active (1)' }));
    expect(screen.queryByText('Anna Cruz')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Disabled (1)' }));
    expect(screen.queryByText('Anna Cruz')).not.toBeInTheDocument();
    await user.click(
      screen.getByRole('button', { name: 'Pending Invitations (1)' }),
    );
    expect(screen.getByText('Anna Cruz')).toBeInTheDocument();
    const edit = screen.getByRole('button', { name: 'Edit Anna Cruz' });
    const remove = screen.getByRole('button', { name: 'Remove Anna Cruz' });
    const view = screen.getByRole('button', { name: 'View Anna Cruz' });
    expect(
      edit.compareDocumentPosition(remove) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      remove.compareDocumentPosition(view) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
  it('uses only the approved role labels', () => {
    render(<ClinicStaffView data={staff} />);
    expect(screen.queryByText(/Regular Secretary/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Operating Secretary/i)).not.toBeInTheDocument();
    expect(
      screen.queryByText(/Clinic Secretary \(Regular\)/i),
    ).not.toBeInTheDocument();
  });
  it('keeps substitute coverage date-based and separate from authority bundles', async () => {
    const user = userEvent.setup();
    render(
      <StaffAssignmentDrawer
        data={staff}
        pending={false}
        message=""
        onClose={() => undefined}
        onSubmit={() => undefined}
      />,
    );
    await user.click(
      screen.getByRole('button', { name: /Assign Existing Secretary/i }),
    );
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(
      screen.getByRole('button', { name: /Substitute Secretary/i }),
    );
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(
      screen.getByRole('heading', { name: 'Substitute Secretary Coverage' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /Authority is fixed and limited to live clinic and queue operations/i,
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText('Set Authority Bundles')).not.toBeInTheDocument();
    expect(screen.queryByText(/Cancel Clinic Day/i)).not.toBeInTheDocument();
  });
  it('filters only the Doctor existing Secretary relationships by name, email, or mobile', async () => {
    const user = userEvent.setup();
    const searchable = {
      ...staff,
      candidates: [
        ...staff.candidates,
        {
          userId: 'candidate-2',
          name: 'Maria Santos',
          email: 'maria@example.test',
          mobileNumber: '09990001111',
        },
      ],
    };
    render(
      <StaffAssignmentDrawer
        data={searchable}
        pending={false}
        message=""
        onClose={() => undefined}
        onSubmit={() => undefined}
      />,
    );
    await user.click(
      screen.getByRole('button', { name: /Assign Existing Secretary/i }),
    );
    const search = screen.getByRole('searchbox', {
      name: 'Search your existing Secretaries',
    });
    await user.type(search, 'maria@example.test');
    expect(screen.getByText('Maria Santos')).toBeInTheDocument();
    expect(screen.queryByText('Jane Reyes')).not.toBeInTheDocument();
  });
  it('invites an existing Secretary without changing access immediately', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const withoutCurrent = {
      ...staff,
      staffAssignments: staff.staffAssignments.filter(
        (item) => !item.isClinicSecretary,
      ),
    };
    render(
      <StaffAssignmentDrawer
        data={withoutCurrent}
        pending={false}
        message=""
        onClose={() => undefined}
        onSubmit={onSubmit}
      />,
    );
    await user.click(
      screen.getByRole('button', { name: /Assign Existing Secretary/i }),
    );
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(
      screen.getByRole('heading', { name: 'Review Invitation' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /must accept this invitation before their clinic assignment or coverage changes/i,
      ),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Send Invitation' }));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        role: 'INVITE_NEW',
        assignmentType: 'CLINIC_SECRETARY',
        identifier: 'jane@example.test',
        authorityBundles: ['QUEUE_AND_CLINIC_DAY_OPERATIONS'],
      }),
    );
  });
  it('continues a new invitation through assignment type, authority, review, and send', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const withoutCurrent = {
      ...staff,
      staffAssignments: staff.staffAssignments.filter(
        (item) => !item.isClinicSecretary,
      ),
    };
    render(
      <StaffAssignmentDrawer
        data={withoutCurrent}
        pending={false}
        message=""
        onClose={() => undefined}
        onSubmit={onSubmit}
      />,
    );
    await user.click(
      screen.getByRole('button', { name: /Invite New Secretary/i }),
    );
    await user.type(
      screen.getByLabelText('Secretary Email or Mobile Number'),
      '09171234567',
    );
    expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(
      screen.getByRole('heading', { name: 'Set Assignment Type' }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(
      screen.getByRole('heading', { name: 'Set Authority Bundles' }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(
      screen.getByRole('heading', { name: 'Review Invitation' }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Send Invitation' }));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        role: 'INVITE_NEW',
        assignmentType: 'CLINIC_SECRETARY',
        identifier: '09171234567',
        authorityBundles: ['QUEUE_AND_CLINIC_DAY_OPERATIONS'],
      }),
    );
  });
  it('requires fresh Doctor authentication before planning Cancel Clinic Day authority', async () => {
    const user = userEvent.setup();
    const withoutCurrent = {
      ...staff,
      staffAssignments: staff.staffAssignments.filter(
        (item) => !item.isClinicSecretary,
      ),
    };
    render(
      <StaffAssignmentDrawer
        data={withoutCurrent}
        pending={false}
        message=""
        onClose={() => undefined}
        onSubmit={() => undefined}
      />,
    );
    await user.click(
      screen.getByRole('button', { name: /Invite New Secretary/i }),
    );
    await user.type(
      screen.getByLabelText('Secretary Email or Mobile Number'),
      'anna@example.test',
    );
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByLabelText(/Allow Cancel Clinic Day/i));
    expect(
      screen.getByLabelText(/current password to grant Cancel Clinic Day/i),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
  });
  it('uses visible view, pen, and trash actions with no three-dot menu', async () => {
    const user = userEvent.setup();
    const onView = vi.fn();
    const onEdit = vi.fn();
    const onRemove = vi.fn();
    render(
      <ClinicStaffView
        data={staff}
        onView={onView}
        onEdit={onEdit}
        onRemove={onRemove}
      />,
    );
    const mariaActions = screen
      .getAllByRole('button')
      .filter((button) =>
        [
          'Edit Maria Santos',
          'Remove Maria Santos',
          'View Maria Santos',
        ].includes(button.getAttribute('aria-label') ?? ''),
      );
    expect(
      mariaActions.map((button) => button.getAttribute('aria-label')),
    ).toEqual([
      'Edit Maria Santos',
      'Remove Maria Santos',
      'View Maria Santos',
    ]);
    await user.click(screen.getByRole('button', { name: 'View Maria Santos' }));
    await user.click(screen.getByRole('button', { name: 'Edit Maria Santos' }));
    await user.click(
      screen.getByRole('button', { name: 'Remove Maria Santos' }),
    );
    expect(onView).toHaveBeenCalledWith(staff.staffAssignments[0]);
    expect(onEdit).toHaveBeenCalledWith(staff.staffAssignments[0]);
    expect(onRemove).toHaveBeenCalledWith(staff.staffAssignments[0]);
    expect(
      screen.queryByRole('button', { name: /More actions/i }),
    ).not.toBeInTheDocument();
  });
  it('shows a read-only Secretary profile with relationship details', () => {
    render(
      <StaffActionDrawer
        staff={staff.staffAssignments[0]}
        mode="VIEW"
        replacementRequired={false}
        pending={false}
        message=""
        clinicName="North Clinic"
        onClose={() => undefined}
        onSubmit={() => undefined}
      />,
    );
    expect(
      screen.getByRole('heading', { name: 'Secretary Profile' }),
    ).toBeInTheDocument();
    expect(screen.getByText('maria@example.test')).toBeInTheDocument();
    expect(screen.getByText('North Clinic')).toBeInTheDocument();
    expect(
      screen.getByText('Queue & Clinic Day Operations'),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument();
  });
  it('does not require the Doctor password for reversible disablement', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(
      <StaffActionDrawer
        staff={staff.staffAssignments[0]}
        mode="EDIT"
        replacementRequired={false}
        pending={false}
        message=""
        clinicName="North Clinic"
        onClose={() => undefined}
        onSubmit={onSubmit}
      />,
    );
    await user.selectOptions(
      screen.getByLabelText('Secretary status'),
      'DISABLED',
    );
    expect(
      screen.getByText(/assignments at other clinics remain unaffected/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByLabelText(/current password/i),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save Changes' }));
    expect(onSubmit).toHaveBeenCalledWith({ type: 'DISABLE' });
  });

  it('edits active Clinic Secretary authority without changing status', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(
      <StaffActionDrawer
        staff={staff.staffAssignments[0]}
        mode="EDIT"
        replacementRequired={false}
        pending={false}
        message=""
        clinicName="North Clinic"
        onClose={() => undefined}
        onSubmit={onSubmit}
      />,
    );
    expect(screen.getByLabelText('Secretary status')).toHaveValue('ACTIVE');
    await user.click(screen.getByText('Appointments & Patient Intake'));
    await user.click(screen.getByRole('button', { name: 'Save Changes' }));
    expect(onSubmit).toHaveBeenCalledWith({
      type: 'UPDATE_CLINIC_AUTHORITY',
      authorityBundles: [
        'QUEUE_AND_CLINIC_DAY_OPERATIONS',
        'APPOINTMENTS_AND_PATIENT_INTAKE',
      ],
    });
    expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument();
  });
  it('allows a disabled clinic connection to be removed while preserving audit history', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(
      <StaffActionDrawer
        staff={staff.staffAssignments[1]}
        mode="REMOVE"
        replacementRequired={false}
        pending={false}
        message=""
        removalImpact={{
          practiceStaffId: 'staff-disabled',
          clinicName: 'North Clinic',
          assignmentActive: false,
          isCurrentClinicSecretary: false,
          clinicWillHaveNoCurrentSecretary: false,
          operatingClinicDays: [],
          activeSubstituteCoverages: [],
          pendingConfigurationDraftCount: 1,
          bookedAppointmentCount: 2,
          bookingsRemainScheduled: true,
          auditHistoryPreserved: true,
        }}
        clinicName="North Clinic"
        onClose={() => undefined}
        onSubmit={onSubmit}
      />,
    );
    expect(
      screen.getByText(/history will remain in the audit log/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/if you cancel or the removal fails/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/2 current or upcoming booked appointments/i),
    ).toBeInTheDocument();
    await user.click(
      screen.getByRole('button', { name: 'Proceed with Removal' }),
    );
    expect(onSubmit).not.toHaveBeenCalled();
    await user.type(
      screen.getByLabelText(/current password to permanently remove/i),
      'DoctorPassword123!',
    );
    await user.click(
      screen.getByRole('button', { name: 'Permanently Remove' }),
    );
    expect(onSubmit).toHaveBeenCalledWith({
      type: 'REMOVE',
      password: 'DoctorPassword123!',
    });
  });
  it('keeps removal separate from the Disable status action', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(
      <StaffActionDrawer
        staff={staff.staffAssignments[0]}
        mode="REMOVE"
        replacementRequired={false}
        pending={false}
        message=""
        removalImpact={{
          practiceStaffId: 'staff-regular',
          clinicName: 'North Clinic',
          assignmentActive: true,
          isCurrentClinicSecretary: true,
          clinicWillHaveNoCurrentSecretary: true,
          operatingClinicDays: [],
          activeSubstituteCoverages: [],
          pendingConfigurationDraftCount: 0,
          bookedAppointmentCount: 0,
          bookingsRemainScheduled: true,
          auditHistoryPreserved: true,
        }}
        clinicName="North Clinic"
        onClose={() => undefined}
        onSubmit={onSubmit}
      />,
    );
    expect(
      screen.queryByText(/Disable at this clinic/i),
    ).not.toBeInTheDocument();
    await user.click(
      screen.getByRole('button', { name: 'Proceed with Removal' }),
    );
    expect(onSubmit).not.toHaveBeenCalled();
    expect(
      screen.getByRole('button', { name: 'Permanently Remove' }),
    ).toBeDisabled();
  });
  it('validates the invite identifier before leaving Invitation Details', async () => {
    const user = userEvent.setup();
    const validateIdentifier = vi
      .fn()
      .mockRejectedValue(
        new Error('Enter a valid email address or Philippine mobile number.'),
      );
    render(
      <StaffAssignmentDrawer
        data={staff}
        pending={false}
        message=""
        onClose={() => undefined}
        onSubmit={() => undefined}
        onValidateInviteIdentifier={validateIdentifier}
      />,
    );
    await user.click(
      screen.getByRole('button', { name: /Invite New Secretary/i }),
    );
    await user.type(
      screen.getByLabelText(
        /Secretary.*Address|Secretary.*Number|Email or Mobile/i,
      ),
      'not-valid',
    );
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(validateIdentifier).toHaveBeenCalled();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Enter a valid email address or Philippine mobile number.',
    );
    expect(
      screen.getByRole('heading', { name: 'Invitation Details' }),
    ).toBeInTheDocument();
  });
  it('keeps the current Clinic Secretary visible in Assign Existing Secretary', async () => {
    const user = userEvent.setup();
    const withCurrentCandidate = {
      ...staff,
      candidates: [
        ...staff.candidates,
        {
          userId: 'user-regular',
          name: 'Maria Santos',
          email: 'maria@example.test',
          mobileNumber: '09172223333',
        },
      ],
    };
    render(
      <StaffAssignmentDrawer
        data={withCurrentCandidate}
        pending={false}
        message=""
        onClose={() => undefined}
        onSubmit={() => undefined}
      />,
    );
    await user.click(screen.getByRole('button', { name: /Assign Existing Secretary/i }));
    expect(screen.getByText('Maria Santos')).toBeInTheDocument();
  });

  it('warns and validates Doctor authentication before review when inviting a replacement Clinic Secretary', async () => {
    const user = userEvent.setup();
    const validateIdentifier = vi.fn().mockResolvedValue({
      existingSecretary: true,
      secretaryName: 'Anna Cruz',
    });
    const validateAuthorization = vi.fn().mockResolvedValue(undefined);
    render(
      <StaffAssignmentDrawer
        data={staff}
        pending={false}
        message=""
        onClose={() => undefined}
        onSubmit={() => undefined}
        onValidateInviteIdentifier={validateIdentifier}
        onValidateInviteAuthorization={validateAuthorization}
      />,
    );
    await user.click(screen.getByRole('button', { name: /Invite New Secretary to Clinic/i }));
    await user.type(screen.getByLabelText(/Secretary Email or Mobile Number/i), 'anna@example.test');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('Replace current Clinic Secretary?')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Continue with Replacement' }));
    const password = screen.getByLabelText(/current password to authorize this replacement/i);
    await user.type(password, 'doctor-password');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(validateAuthorization).toHaveBeenCalledWith('doctor-password');
    expect(screen.getByRole('heading', { name: 'Review Invitation' })).toBeInTheDocument();
  });

});


it('reviews replacing a pending Clinic Secretary invitation before continuing', async () => {
  const user = userEvent.setup();
  const onSubmit = vi.fn();
  const data: AuthoritativeClinicStaff = { ...staff, pendingInvitations: [{ invitationId: 'pending', name: 'Pending Secretary', email: 'pending@example.test', mobileNumber: null, status: 'PENDING', assignmentType: 'CLINIC_SECRETARY', authorityBundles: [], coverageMode: null, fromServiceDate: null, toServiceDate: null, invitedAt: '2026-01-01', expiresAt: '2099-01-01' }] };
  render(<StaffAssignmentDrawer data={data} pending={false} message="" onClose={vi.fn()} onSubmit={onSubmit} />);
  await user.click(screen.getByRole('button', { name: /Invite New Secretary/i }));
  await user.type(screen.getByLabelText('Secretary Email or Mobile Number'), 'second@example.test');
  await user.click(screen.getByRole('button', { name: 'Next' }));
  expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled();
  await user.click(screen.getByRole('button', { name: 'Next' }));
  expect(screen.getByRole('dialog', { name: 'Review Clinic Secretary Replacement' })).toBeInTheDocument();
  expect(screen.getByText('Replace pending invitation?')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Go Back' }));
  expect(onSubmit).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Next' }));
  await user.click(screen.getByRole('button', { name: 'Continue with Replacement' }));
  expect(screen.getByRole('heading', { name: 'Set Authority Bundles' })).toBeInTheDocument();
  expect(onSubmit).not.toHaveBeenCalled();
  await user.type(screen.getByLabelText(/current password to authorize this replacement/i), 'doctor-password');
  await user.click(screen.getByRole('button', { name: 'Next' }));
  await user.click(screen.getByRole('button', { name: 'Send Invitation' }));
  expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ replacePendingInvitationIds: ['pending'] }));
});


it.each([{ pendingInvite: true, full: false }, { pendingInvite: true, full: true }, { pendingInvite: false, full: false }, { pendingInvite: false, full: true }])('reviews substitute overlap before proceeding: %j', async ({ pendingInvite, full }) => {
  const user = userEvent.setup();
  const onSubmit = vi.fn();
  const data: AuthoritativeClinicStaff = { ...staff, staffAssignments: pendingInvite ? [] : [{ ...staff.staffAssignments[0], isClinicSecretary: false, assignmentType: 'SUBSTITUTE_SECRETARY', substituteCoverages: [{ id: 'coverage', coverageMode: 'DATE_RANGE', fromServiceDate: '2027-06-01', toServiceDate: '2027-06-10', status: 'ACTIVE', createdAt: '2026-01-01', endedAt: null }] }], pendingInvitations: pendingInvite ? [{ invitationId: 'pending-substitute', name: 'Pending Secretary', email: null, mobileNumber: '+639171234567', status: 'PENDING', assignmentType: 'SUBSTITUTE_SECRETARY', authorityBundles: [], coverageMode: 'DATE_RANGE', fromServiceDate: '2027-06-01', toServiceDate: '2027-06-10', invitedAt: '2026-01-01', expiresAt: '2099-01-01' }] : [] };
  render(<StaffAssignmentDrawer data={data} pending={false} message="" onClose={vi.fn()} onSubmit={onSubmit} />);
  await user.click(screen.getByRole('button', { name: /Invite New Secretary/i }));
  await user.type(screen.getByLabelText('Secretary Email or Mobile Number'), 'new@example.test');
  await user.click(screen.getByRole('button', { name: 'Next' }));
  await user.click(screen.getByRole('button', { name: /Substitute Secretary/i }));
  await user.click(screen.getByRole('button', { name: 'Next' }));
  await user.click(screen.getByRole('button', { name: 'Add period' }));
  await user.click(screen.getByLabelText('Date Range'));
  fireEvent.change(screen.getByLabelText('From'), { target: { value: full ? '2027-06-01' : '2027-06-04' } });
  fireEvent.change(screen.getByLabelText('To'), { target: { value: full ? '2027-06-10' : '2027-06-06' } });
  await user.click(screen.getByRole('button', { name: 'Add' }));
  expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled();
  await user.click(screen.getByRole('button', { name: 'Next' }));
  expect(screen.getByRole('dialog', { name: 'Review Substitute Coverage Replacement' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: pendingInvite ? (full ? 'Cancel pending invitation' : 'Revise pending coverage') : (full ? 'Disable clinic access on acceptance' : 'Revise active coverage on acceptance') })).toBeInTheDocument();
  if (!full) expect(screen.getByText(/2027-06-01 – 2027-06-03, 2027-06-07 – 2027-06-10/)).toBeInTheDocument();
  expect(onSubmit).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Continue with Replacement' }));
  await user.click(screen.getByRole('button', { name: 'Send Invitation' }));
  expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ assignmentType: 'SUBSTITUTE_SECRETARY', replacePendingInvitationIds: pendingInvite ? ['pending-substitute'] : [] }));
});


it('invites a disabled existing mobile-primary Secretary through the substitute replacement review', async () => {
  const user = userEvent.setup();
  const onSubmit = vi.fn();
  const validate = vi.fn().mockResolvedValue({ existingSecretary: true, secretaryName: 'Returning Secretary' });
  const data: AuthoritativeClinicStaff = { ...staff, candidates: [{ userId: 'returning', name: 'Returning Secretary', email: 'secondary@example.test', mobileNumber: '+639171234567', identifier: '+639171234567' }], staffAssignments: [{ ...staff.staffAssignments[1], userId: 'returning' }], pendingInvitations: [{ invitationId: 'old-pending', name: 'Other Secretary', email: 'other@example.test', mobileNumber: null, status: 'PENDING', assignmentType: 'SUBSTITUTE_SECRETARY', authorityBundles: [], coverageMode: 'DATE_RANGE', fromServiceDate: '2027-07-01', toServiceDate: '2027-07-10', invitedAt: '2026-01-01', expiresAt: '2099-01-01' }] };
  render(<StaffAssignmentDrawer data={data} pending={false} message="" onClose={vi.fn()} onSubmit={onSubmit} onValidateInviteIdentifier={validate} />);
  await user.click(screen.getByRole('button', { name: /Assign Existing Secretary/i }));
  expect(screen.getByText('Returning Secretary')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Next' }));
  expect(validate).toHaveBeenCalledWith('+639171234567');
  await user.click(screen.getByRole('button', { name: /Substitute Secretary/i }));
  await user.click(screen.getByRole('button', { name: 'Next' }));
  await user.click(screen.getByRole('button', { name: 'Add period' }));
  fireEvent.change(screen.getByLabelText('From'), { target: { value: '2027-07-05' } });
  await user.click(screen.getByRole('button', { name: 'Add' }));
  await user.click(screen.getByRole('button', { name: 'Next' }));
  expect(screen.getByRole('dialog', { name: 'Review Substitute Coverage Replacement' })).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Continue with Replacement' }));
  await user.click(screen.getByRole('button', { name: 'Send Invitation' }));
  expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ role: 'INVITE_NEW', assignmentType: 'SUBSTITUTE_SECRETARY', identifier: '+639171234567', replacePendingInvitationIds: ['old-pending'] }));
});
