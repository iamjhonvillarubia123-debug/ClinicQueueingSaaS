import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SecretaryProfilePage } from './SecretaryProfilePage';

function response(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

afterEach(() => vi.restoreAllMocks());

describe('Secretary Profile', () => {
  it('connects clinic assignments while leaving unsupported profile fields unclaimed', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({
      clinics: [
        { practiceStaffId: 'staff-1', clinicId: 'clinic-1', clinicName: 'Main Clinic', address: 'Cebu City', timeZone: 'Asia/Manila', doctorName: 'Juan Dela Cruz', status: 'ACTIVE', assignmentType: 'CLINIC_SECRETARY', authorityBundles: [], substituteCoverages: [], assignedAt: '2026-09-01T00:00:00.000Z' },
      ],
      invitations: [],
    }));

    render(<SecretaryProfilePage />);

    expect(screen.getByRole('heading', { name: 'Secretary Profile' })).toBeInTheDocument();
    expect(await screen.findByText('Main Clinic')).toBeInTheDocument();
    expect(screen.getByText('Dr. Juan Dela Cruz')).toBeInTheDocument();
    expect(screen.getByText(/clinic connections are managed by your Doctor/i)).toBeInTheDocument();
    expect(screen.getByLabelText('First Name')).toHaveAttribute('placeholder', 'Not connected');
  });
});
