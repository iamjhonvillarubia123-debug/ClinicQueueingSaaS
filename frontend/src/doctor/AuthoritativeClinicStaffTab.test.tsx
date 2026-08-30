import { cleanup, render, screen, within } from '@testing-library/react';
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
      assignedAt: '2026-08-10T00:00:00.000Z',
      updatedAt: '2026-08-10T00:00:00.000Z',
      isRegular: false,
      isOperating: true,
    },
  ],
};

afterEach(cleanup);

describe('ClinicStaffView', () => {
  it('presents regular and service-date Operating Secretary as distinct authority roles', () => {
    render(
      <ServiceDateTodayProvider today="2026-08-30">
        <ClinicStaffView
          data={staff}
          serviceDate="2026-08-30"
          onServiceDateChange={vi.fn()}
        />
      </ServiceDateTodayProvider>,
    );

    const regularCard = screen
      .getByRole('heading', { name: 'Current Regular Secretary' })
      .closest('article');
    expect(regularCard).not.toBeNull();
    expect(within(regularCard as HTMLElement).getByText('Maria Santos')).toBeInTheDocument();

    const operatingCard = screen
      .getByRole('heading', {
        name: 'Operating Secretary for August 30, 2026',
      })
      .closest('article');
    expect(operatingCard).not.toBeNull();
    expect(within(operatingCard as HTMLElement).getByText('Jane Reyes')).toBeInTheDocument();
    expect(
      within(operatingCard as HTMLElement).queryByText('Maria Santos'),
    ).not.toBeInTheDocument();

    const assignments = screen
      .getByRole('heading', { name: 'Practice Staff Assignments (2)' })
      .closest('article');
    expect(assignments).not.toBeNull();
    expect(within(assignments as HTMLElement).getByText('Regular')).toBeInTheDocument();
    expect(within(assignments as HTMLElement).getByText('Operating')).toBeInTheDocument();
    expect(
      screen.getByText('Staff changes are not enabled in this checkpoint.'),
    ).toBeInTheDocument();
  });
});
