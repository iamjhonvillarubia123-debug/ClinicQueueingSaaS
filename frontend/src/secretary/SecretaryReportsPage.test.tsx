import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SecretaryReportsPage } from './SecretaryReportsPage';

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => vi.restoreAllMocks());

describe('Secretary Reports', () => {
  it('shows only active clinics where Reports View Only authority is granted', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({
      clinics: [
        {
          practiceStaffId: 'staff-1',
          clinicId: 'clinic-1',
          clinicName: 'Authorized Clinic',
          address: 'Davao City',
          timeZone: 'Asia/Manila',
          doctorName: 'Juan Dela Cruz',
          status: 'ACTIVE',
          assignmentType: 'CLINIC_SECRETARY',
          authorityBundles: ['REPORTS_VIEW_ONLY'],
          substituteCoverages: [],
          assignedAt: '2026-09-01T00:00:00.000Z',
        },
        {
          practiceStaffId: 'staff-2',
          clinicId: 'clinic-2',
          clinicName: 'No Reports Authority',
          address: 'Cebu City',
          timeZone: 'Asia/Manila',
          doctorName: 'Maria Santos',
          status: 'ACTIVE',
          assignmentType: 'CLINIC_SECRETARY',
          authorityBundles: ['QUEUE_AND_CLINIC_DAY_OPERATIONS'],
          substituteCoverages: [],
          assignedAt: '2026-09-01T00:00:00.000Z',
        },
        {
          practiceStaffId: 'staff-3',
          clinicId: 'clinic-3',
          clinicName: 'Disabled Reports Clinic',
          address: 'Manila',
          timeZone: 'Asia/Manila',
          doctorName: 'Pedro Reyes',
          status: 'DISABLED',
          assignmentType: 'CLINIC_SECRETARY',
          authorityBundles: ['REPORTS_VIEW_ONLY'],
          substituteCoverages: [],
          assignedAt: '2026-09-01T00:00:00.000Z',
        },
      ],
      invitations: [],
    }));

    render(<SecretaryReportsPage />);

    expect(await screen.findByRole('option', { name: 'Authorized Clinic' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'No Reports Authority' })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Disabled Reports Clinic' })).not.toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'All Clinics (1)' })).toBeInTheDocument();
  });
});
