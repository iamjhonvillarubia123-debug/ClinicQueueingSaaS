import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useParams } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClinicTabPage } from './ClinicTab';

const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }));

vi.mock('../api/client', () => ({ apiRequest }));

afterEach(() => {
  cleanup();
  apiRequest.mockReset();
});

function OperationsDestination() {
  const { clinicId } = useParams();
  return <h1>Opened clinic {clinicId}</h1>;
}

describe('Open Clinic navigation', () => {
  it('navigates an active clinic row to its operations route', async () => {
    apiRequest.mockResolvedValue([
      {
        id: 'north-clinic-id',
        lifecycleStatus: 'ACTIVE',
        name: 'North Clinic',
        addressLine1: 'Davao City',
        countryCode: 'PH',
        timeZone: 'Asia/Manila',
        services: [],
        bookingQuestions: [],
        practiceSchedules: [],
        doctorScheduleDraft: null,
      },
    ]);
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/app/clinics']}>
        <Routes>
          <Route path="/app/clinics" element={<ClinicTabPage />} />
          <Route path="/app/clinics/:clinicId/operations" element={<OperationsDestination />} />
        </Routes>
      </MemoryRouter>,
    );

    await user.click(await screen.findByRole('button', { name: 'Open Clinic' }));
    expect(screen.getByRole('heading', { name: 'Opened clinic north-clinic-id' })).toBeInTheDocument();
  });
});
