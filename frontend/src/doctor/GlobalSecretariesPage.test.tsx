import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  GlobalSecretariesPage,
  SecretaryDirectoryView,
  type SecretaryDirectory,
} from './GlobalSecretariesPage';

const directory: SecretaryDirectory = {
  assignments: [
    {
      practiceStaffId: 'staff-1',
      name: 'Jane Reyes',
      email: 'jane@example.test',
      mobileNumber: '0918',
      clinic: { id: 'clinic-1', name: 'North Clinic' },
      operationallyReady: true,
      isClinicSecretary: true,
      assignedAt: '2026-08-28T00:00:00Z',
      substituteCoverages: [],
    },
  ],
  pendingInvitations: [
    {
      invitationId: 'invite-1',
      name: 'Anna Cruz',
      email: 'anna@example.test',
      mobileNumber: '0917',
      clinic: { id: 'clinic-2', name: 'South Clinic' },
      status: 'PENDING',
      assignmentType: 'CLINIC_SECRETARY',
      authorityBundles: ['QUEUE_AND_CLINIC_DAY_OPERATIONS'],
      requestedCancelClinicDay: false,
      coverageMode: null,
      fromServiceDate: null,
      toServiceDate: null,
      invitedAt: '2026-08-29T00:00:00Z',
      expiresAt: '2026-09-05T00:00:00Z',
    },
  ],
};

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('SecretaryDirectoryView', () => {
  it('shows clinic context and only approved role labels', () => {
    render(<SecretaryDirectoryView data={directory} />);
    expect(screen.getByText('North Clinic')).toBeInTheDocument();
    expect(screen.getAllByText('Clinic Secretary').length).toBeGreaterThan(0);
    expect(screen.queryByText(/Regular Secretary/i)).not.toBeInTheDocument();
  });

  it('shows authoritative pending invitations', async () => {
    const user = userEvent.setup();
    render(<SecretaryDirectoryView data={directory} />);
    await user.click(
      screen.getByRole('button', { name: 'Pending Invitations (1)' }),
    );
    expect(screen.getByText('Anna Cruz')).toBeInTheDocument();
    expect(screen.getByText('South Clinic')).toBeInTheDocument();
  });

  it('exposes edit remove and view actions for pending invitations', async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn();
    const onRemove = vi.fn();
    const onView = vi.fn();
    render(
      <SecretaryDirectoryView
        data={directory}
        onInvitationEdit={onEdit}
        onInvitationRemove={onRemove}
        onInvitationView={onView}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Edit Anna Cruz' }));
    await user.click(screen.getByRole('button', { name: 'Remove Anna Cruz' }));
    await user.click(screen.getByRole('button', { name: 'View Anna Cruz' }));

    expect(onEdit).toHaveBeenCalledWith(directory.pendingInvitations[0]);
    expect(onRemove).toHaveBeenCalledWith(directory.pendingInvitations[0]);
    expect(onView).toHaveBeenCalledWith(directory.pendingInvitations[0]);
  });
});

describe('GlobalSecretariesPage drawer layout', () => {
  it('opens pending invitation removal in the approved right-side drawer shell', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(directory));
    const user = userEvent.setup();
    render(<GlobalSecretariesPage />);

    await screen.findByText('Anna Cruz');
    const shell = screen.getByTestId('global-secretaries-shell');
    expect(shell).not.toHaveClass('has-drawer');

    await user.click(screen.getByRole('button', { name: 'Remove Anna Cruz' }));

    expect(shell).toHaveClass('has-drawer');
    expect(
      screen.getByRole('complementary', {
        name: 'REMOVE pending invitation drawer',
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Remove Pending Invitation' }),
    ).toBeInTheDocument();
  });
});
