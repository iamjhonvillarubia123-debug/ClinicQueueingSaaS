import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { SecretaryStaffingPage } from './SecretaryStaffingPage';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('clinic Staff configuration tab', () => {
  it('shows the current Secretary and the password-protected replacement choices', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      location: { id: 'location-1', name: 'North Clinic', lifecycleStatus: 'ACTIVE', currentRegularPracticeStaffId: 'staff-1' },
      regularSecretary: {
        id: 'staff-1', isActive: true, createdAt: '2026-08-24T00:00:00.000Z',
        user: { id: 'secretary-1', firstName: 'Wew', middleName: null, lastName: 'Secretary', email: 'wew@example.com', mobileNumber: '+639171234567', emailVerifiedAt: '2026-08-24T00:00:00.000Z', accountStatus: 'ACTIVE', administrativeRestrictionStatus: 'NONE' },
      },
    })));
    render(<MemoryRouter initialEntries={['/app/practice-locations/location-1/staff']}><Routes><Route path="/app/practice-locations/:practiceLocationId/staff" element={<SecretaryStaffingPage />} /></Routes></MemoryRouter>);
    expect(await screen.findByText('Wew Secretary')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Staff' })).toHaveAttribute('aria-current', 'page');
    fireEvent.click(screen.getByRole('button', { name: 'Replace Secretary' }));
    expect(screen.getByRole('button', { name: 'Existing Secretary' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New Secretary' })).toBeInTheDocument();
  });
});
