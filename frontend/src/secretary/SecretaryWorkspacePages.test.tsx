import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  SecretaryClinicsPage,
  SecretaryClinicWorkspacePage,
  SecretaryInvitationsPage,
} from './SecretaryWorkspacePages';

const workspace = {
  clinics: [
    {
      practiceStaffId: 'staff-1',
      clinicId: 'clinic-1',
      clinicName: 'North Clinic',
      address: 'Davao City',
      timeZone: 'Asia/Manila',
      doctorName: 'Maria Doctor',
      status: 'ACTIVE',
      assignmentType: 'CLINIC_SECRETARY',
      authorityBundles: [
        'QUEUE_AND_CLINIC_DAY_OPERATIONS',
        'REPORTS_VIEW_ONLY',
      ],
      substituteCoverages: [],
      assignedAt: '2026-09-01T00:00:00Z',
    },
  ],
  invitations: [
    {
      invitationId: 'invite-1',
      clinicId: 'clinic-2',
      clinicName: 'South Clinic',
      doctorName: 'Jose Doctor',
      assignmentType: 'CLINIC_SECRETARY',
      authorityBundles: ['APPOINTMENTS_AND_PATIENT_INTAKE'],
      requestedCancelClinicDay: false,
      coverageMode: null,
      fromServiceDate: null,
      toServiceDate: null,
      invitedAt: '2026-09-01T00:00:00Z',
      expiresAt: '2026-09-08T00:00:00Z',
    },
  ],
};

function response(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

afterEach(() => vi.restoreAllMocks());

describe('Secretary workspace pages', () => {
  it('shows accepted clinic relationships', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(response(workspace));
    render(
      <MemoryRouter>
        <SecretaryClinicsPage />
      </MemoryRouter>,
    );
    expect(
      await screen.findByRole('heading', { name: 'North Clinic' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Maria Doctor')).toBeInTheDocument();
  });

  it('accepts an in-app invitation and removes it from pending results', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(response(workspace))
      .mockResolvedValueOnce(response({ accepted: true }))
      .mockResolvedValueOnce(response({ ...workspace, invitations: [] }));
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <SecretaryInvitationsPage />
      </MemoryRouter>,
    );
    await user.click(
      await screen.findByRole('button', { name: 'Accept Invitation' }),
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(fetchMock.mock.calls[1][0]).toContain(
      '/practice-staff/invitations/invite-1/accept',
    );
    expect(
      await screen.findByText('No pending invitations'),
    ).toBeInTheDocument();
  });

  it('shows only modules represented by granted authority', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = String(input);
      if (url.includes('/secretary/workspace')) return Promise.resolve(response(workspace));
      if (url.includes('/operations/context'))
        return Promise.resolve(response({ practiceLocationId: 'clinic-1', clinicName: 'North Clinic', timeZone: 'Asia/Manila', currentServiceDate: '2026-09-02' }));
      const clinic = { id: 'clinic-1', name: 'North Clinic', address: 'Davao City', countryCode: 'PH', timeZone: 'Asia/Manila', lifecycleStatus: 'ACTIVE', doctorName: 'Maria Doctor' };
      if (url.includes('/operations/overview'))
        return Promise.resolve(response({ clinic, serviceDate: '2026-09-02', schedule: { isOpen: false, opensAt: null, closesAt: null }, clinicDay: null, queue: { counts: {}, waitingCount: 0, nowServing: null, next: null, waitingPreview: [] }, appointments: { total: 0, counts: {} }, timeline: [] }));
      return Promise.resolve(response({ clinic, serviceDate: '2026-09-02', schedule: { isOpen: false, opensAt: null, closesAt: null }, clinicDay: null, counts: {}, patients: [], timeline: [] }));
    });
    render(
      <MemoryRouter initialEntries={['/app/secretary/clinics/clinic-1']}>
        <Routes>
          <Route
            path="/app/secretary/clinics/:clinicId"
            element={<SecretaryClinicWorkspacePage />}
          />
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByRole('button', { name: 'Overview' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Queue' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Appointments' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Staff' })).not.toBeInTheDocument();
  });
});
