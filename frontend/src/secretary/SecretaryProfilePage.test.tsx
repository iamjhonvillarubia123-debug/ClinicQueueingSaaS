import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SecretaryProfilePage } from './SecretaryProfilePage';

function response(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => vi.restoreAllMocks());

describe('Secretary Profile', () => {
  it('hydrates account identity and clinic assignments while leaving optional profile fields unclaimed', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      response({
        account: {
          firstName: 'Maria',
          lastName: 'Secretary',
          email: 'maria@example.test',
          mobileNumber: '09171234567',
        },
        clinics: [
          {
            practiceStaffId: 'staff-1',
            clinicId: 'clinic-1',
            clinicName: 'Main Clinic',
            address: 'Cebu City',
            timeZone: 'Asia/Manila',
            doctorName: 'Juan Dela Cruz',
            status: 'ACTIVE',
            assignmentType: 'CLINIC_SECRETARY',
            authorityBundles: [],
            substituteCoverages: [],
            assignedAt: '2026-09-01T00:00:00.000Z',
          },
        ],
        invitations: [],
      }),
    );

    render(<SecretaryProfilePage />);

    expect(
      screen.getByRole('heading', { name: 'Secretary Profile' }),
    ).toBeInTheDocument();
    expect(await screen.findByText('Maria Secretary')).toBeInTheDocument();
    expect(
      screen.getByText('maria@example.test · 09171234567'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('First Name')).toHaveValue('Maria');
    expect(screen.getByLabelText('Last Name')).toHaveValue('Secretary');
    expect(screen.getByLabelText('Preferred Name (Optional)')).toHaveValue('');
    expect(await screen.findByText('Main Clinic')).toBeInTheDocument();
    expect(screen.getByText('Dr. Juan Dela Cruz')).toBeInTheDocument();
    expect(
      screen.getByText(/clinic connections are managed by your Doctor/i),
    ).toBeInTheDocument();
  });
});
