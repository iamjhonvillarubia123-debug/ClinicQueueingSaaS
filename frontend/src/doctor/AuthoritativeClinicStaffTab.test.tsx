import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ClinicStaffView,
  type AuthoritativeClinicStaff,
} from './AuthoritativeClinicStaffTab';
import { ServiceDateTodayProvider } from './ServiceDateControl';

const staff: AuthoritativeClinicStaff = {
  clinic: { id: 'clinic-1', name: 'North Clinic' },
  serviceDate: '2026-08-30',
  regularSecretary: {
    practiceStaffId: 'staff-regular',
    userId: 'user-regular',
    name: 'Maria Santos',
    email: 'maria@example.test',
    staffRole: 'SECRETARY',
    assignmentActive: true,
    userRole: 'SECRETARY',
    accountStatus: 'ACTIVE',
    operationallyReady: true,
    assignedAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
  },
  operatingSecretary: {
    practiceStaffId: 'staff-substitute',
    userId: 'user-substitute',
    name: 'Jane Reyes',
    email: 'jane@example.test',
    staffRole: 'SECRETARY',
    assignmentActive: true,
    userRole: 'SECRETARY',
    accountStatus: 'ACTIVE',
    operationallyReady: true,
    assignedAt: '2026-08-10T00:00:00.000Z',
    updatedAt: '2026-08-10T00:00:00.000Z',
  },
  clinicDay: {
    id: 'day-1',
    status: 'STARTED',
    operatingPracticeStaffId: 'staff-substitute',
  },
  staffAssignments: [
    {
      practiceStaffId: 'staff-regular',
      userId: 'user-regular',
      name: 'Maria Santos',
      email: 'maria@example.test',
      staffRole: 'SECRETARY',
      assignmentActive: true,
      userRole: 'SECRETARY',
      accountStatus: 'ACTIVE',
      operationallyReady: true,
      assignedAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z',
      isRegular: true,
      isOperating: false,
    },
    {
      practiceStaffId: 'staff-substitute',
      userId: 'user-substitute',
      name: 'Jane Reyes',
      email: 'jane@example.test',
      staffRole: 'SECRETARY',
      assignmentActive: true,
      userRole: 'SECRETARY',
      accountStatus: 'ACTIVE',
      operationallyReady: true,
      assignedAt: '2026-08-10T00:00:00.000Z',
      updatedAt: '2026-08-10T00:00:00.000Z',
      isRegular: false,
      isOperating: true,
    },
  ],
};

afterEach(cleanup);

describe('ClinicStaffView', () => {
  it('presents Clinic Secretary and Secretary for the Day as distinct user-facing concepts', () => {
    render(
      <ServiceDateTodayProvider today="2026-08-30">
        <ClinicStaffView
          data={staff}
          serviceDate="2026-08-30"
          onServiceDateChange={vi.fn()}
        />
      </ServiceDateTodayProvider>,
    );

    expect(screen.getAllByText('Secretary for the Day').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Clinic Secretary').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Jane Reyes').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Maria Santos').length).toBeGreaterThan(0);
    expect(screen.queryByText('Operating Secretary')).not.toBeInTheDocument();
    expect(screen.queryByText('Regular Secretary')).not.toBeInTheDocument();
  });

  it('opens the Secretary for the Day drawer and performs a started-day handoff', async () => {
    const user = userEvent.setup();
    const onOperatingSecretaryAction = vi.fn();

    render(
      <ServiceDateTodayProvider today="2026-08-30">
        <ClinicStaffView
          data={staff}
          serviceDate="2026-08-30"
          onServiceDateChange={vi.fn()}
          onOperatingSecretaryAction={onOperatingSecretaryAction}
        />
      </ServiceDateTodayProvider>,
    );

    await user.click(
      screen.getByRole('button', { name: 'Change Secretary for the Day' }),
    );

    const drawer = screen.getByRole('complementary', {
      name: 'Secretary for the Day drawer',
    });
    expect(
      within(drawer).getByText(/does not change the regular Clinic Secretary assignment/i),
    ).toBeInTheDocument();
    expect(within(drawer).getByText('Maria Santos')).toBeInTheDocument();

    await user.click(
      within(drawer).getByRole('button', { name: 'Change Secretary for the Day' }),
    );

    expect(onOperatingSecretaryAction).toHaveBeenCalledWith({
      type: 'REPLACE',
      clinicDayId: 'day-1',
      userId: 'user-regular',
    });
  });

  it('supports initial day assignment before ClinicDay creation and excludes non-ready staff', async () => {
    const user = userEvent.setup();
    const onOperatingSecretaryAction = vi.fn();
    const beforeStart: AuthoritativeClinicStaff = {
      ...staff,
      operatingSecretary: null,
      clinicDay: null,
      staffAssignments: [
        { ...staff.staffAssignments[0], isOperating: false },
        {
          ...staff.staffAssignments[1],
          isOperating: false,
          operationallyReady: false,
        },
      ],
    };

    render(
      <ServiceDateTodayProvider today="2026-08-30">
        <ClinicStaffView
          data={beforeStart}
          serviceDate="2026-08-30"
          onServiceDateChange={vi.fn()}
          onOperatingSecretaryAction={onOperatingSecretaryAction}
        />
      </ServiceDateTodayProvider>,
    );

    await user.click(
      screen.getByRole('button', { name: 'Assign Secretary for the Day' }),
    );
    const drawer = screen.getByRole('complementary', {
      name: 'Secretary for the Day drawer',
    });
    expect(within(drawer).getByText('Maria Santos')).toBeInTheDocument();
    expect(within(drawer).queryByText('Jane Reyes')).not.toBeInTheDocument();

    await user.click(
      within(drawer).getByRole('button', { name: 'Assign Secretary for the Day' }),
    );
    expect(onOperatingSecretaryAction).toHaveBeenCalledWith({
      type: 'ASSIGN',
      userId: 'user-regular',
    });
  });

  it('can remove the Secretary for the Day and return control to the Doctor', async () => {
    const user = userEvent.setup();
    const onOperatingSecretaryAction = vi.fn();

    render(
      <ServiceDateTodayProvider today="2026-08-30">
        <ClinicStaffView
          data={staff}
          serviceDate="2026-08-30"
          onServiceDateChange={vi.fn()}
          onOperatingSecretaryAction={onOperatingSecretaryAction}
        />
      </ServiceDateTodayProvider>,
    );

    await user.click(
      screen.getByRole('button', { name: 'Change Secretary for the Day' }),
    );
    const drawer = screen.getByRole('complementary', {
      name: 'Secretary for the Day drawer',
    });
    await user.click(
      within(drawer).getByRole('button', { name: 'Remove Secretary for the Day' }),
    );

    expect(onOperatingSecretaryAction).toHaveBeenCalledWith({
      type: 'CLEAR',
      clinicDayId: 'day-1',
    });
  });
});
