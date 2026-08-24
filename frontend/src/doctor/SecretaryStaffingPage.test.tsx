import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { SecretaryStaffingPage } from './SecretaryStaffingPage';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('clinic Staff configuration tab', () => {
  it('shows the current Secretary, access profile, and password-protected replacement choices', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      location: { id: 'location-1', name: 'North Clinic', lifecycleStatus: 'ACTIVE', currentRegularPracticeStaffId: 'staff-1' },
      regularSecretary: {
        id: 'staff-1',
        isActive: true,
        createdAt: '2026-08-24T00:00:00.000Z',
        accessProfile: 'CUSTOM',
        canManageClinicDetails: false,
        canManageServices: true,
        canManageBookingQuestions: true,
        canManageSchedules: false,
        capabilities: [{ capabilityType: 'ASSIGN_DAY_SECRETARY' }],
        user: { id: 'secretary-1', firstName: 'Wew', middleName: null, lastName: 'Secretary', email: 'wew@example.com', mobileNumber: '+639171234567', emailVerifiedAt: '2026-08-24T00:00:00.000Z', accountStatus: 'ACTIVE', administrativeRestrictionStatus: 'NONE' },
      },
    })));
    render(<MemoryRouter initialEntries={['/app/practice-locations/location-1/staff']}><Routes><Route path="/app/practice-locations/:practiceLocationId/staff" element={<SecretaryStaffingPage />} /></Routes></MemoryRouter>);
    expect(await screen.findByText('Wew Secretary')).toBeInTheDocument();
    expect(screen.getByText('Custom')).toBeInTheDocument();
    expect(screen.getByText('Assign day Secretary').parentElement).toHaveTextContent('Granted');
    expect(screen.getByRole('link', { name: 'Staff' })).toHaveAttribute('aria-current', 'page');
    fireEvent.click(screen.getByRole('button', { name: 'Replace Secretary' }));
    expect(screen.getByRole('button', { name: 'Existing Secretary' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New Secretary' })).toBeInTheDocument();
  });

  it('requires access selection before sending a new Secretary invitation', async () => {
    const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/practice-staff/regular/location-1') && (!init?.method || init.method === 'GET')) {
        return Promise.resolve(jsonResponse({
          location: { id: 'location-1', name: 'North Clinic', lifecycleStatus: 'ACTIVE', currentRegularPracticeStaffId: null },
          regularSecretary: null,
        }));
      }
      if (url.includes('/secretary/invitations')) {
        return Promise.resolve(jsonResponse({ outcome: 'INVITATION_CREATED', invitationId: 'invite-1', expiresAt: '2026-08-27T00:00:00.000Z' }));
      }
      return Promise.resolve(jsonResponse({}));
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<MemoryRouter initialEntries={['/app/practice-locations/location-1/staff']}><Routes><Route path="/app/practice-locations/:practiceLocationId/staff" element={<SecretaryStaffingPage />} /></Routes></MemoryRouter>);
    await screen.findByText('No regular Secretary');
    fireEvent.click(screen.getByRole('button', { name: 'Add new Secretary' }));
    expect(screen.getByText('Choose Secretary access')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText(/Full clinic configuration/));
    fireEvent.change(screen.getByLabelText('First name'), { target: { value: 'Ana' } });
    fireEvent.change(screen.getByLabelText('Last name'), { target: { value: 'Santos' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'ana@example.com' } });
    fireEvent.change(screen.getByLabelText('Mobile number'), { target: { value: '09171234567' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send secure invitation' }));
    await screen.findByText(/invitation created with the selected clinic access/i);
    const invitationCall = fetchMock.mock.calls.find(([input]) => String(input).includes('/secretary/invitations'));
    expect(invitationCall).toBeTruthy();
    const body = JSON.parse(String((invitationCall?.[1] as RequestInit).body));
    expect(body.accessProfile).toBe('FULL_CLINIC_CONFIGURATION');
    expect(body.canManageServices).toBe(true);
    expect(body.canManageSchedules).toBe(true);
  });
});
