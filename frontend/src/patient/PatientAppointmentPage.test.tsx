import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { PatientAppointmentPage } from './PatientAppointmentPage';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const baseDashboard = {
  bookingReference: 'CQ-ABC123',
  patientName: { firstName: 'Ana', middleName: null, lastName: 'Santos', suffix: null },
  practiceLocation: { id: 'internal-location-id', name: 'North Clinic' },
  serviceDate: '2026-08-23T00:00:00.000Z',
  queueNumber: 7,
  status: 'WAITING',
  estimatedServiceMinutes: 30,
  clinicDayStatus: 'STARTED',
  nowServingQueueNumber: 4,
  patientsAhead: 2,
  canUseImHere: false,
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/patient-bookings/CQ-ABC123']}>
      <Routes>
        <Route path="/patient-bookings/:bookingReference" element={<PatientAppointmentPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('F4 individual patient appointment dashboard', () => {
  it('shows the permanent Queue Number and authoritative live queue information', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(baseDashboard));
    renderPage();

    expect(await screen.findByRole('heading', { name: 'You are in the queue' })).toBeInTheDocument();
    expect(screen.getByLabelText('Queue number 7')).toHaveTextContent('7');
    expect(screen.getByText('Now serving').parentElement).toHaveTextContent('4');
    expect(screen.getByText('People ahead').parentElement).toHaveTextContent('2');
    expect(screen.getByText('CQ-ABC123')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3000/patient-bookings/CQ-ABC123/dashboard',
      expect.objectContaining({ credentials: 'include' }),
    );
  });

  it('offers I’m Here only when the backend explicitly authorizes it and refreshes after success', async () => {
    const absent = { ...baseDashboard, status: 'TEMPORARILY_ABSENT', canUseImHere: true, patientsAhead: null };
    const waiting = { ...baseDashboard, status: 'WAITING', canUseImHere: false, patientsAhead: 3 };
    let dashboardReads = 0;
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith('/patient-bookings/CQ-ABC123/dashboard')) {
        dashboardReads += 1;
        return jsonResponse(dashboardReads === 1 ? absent : waiting);
      }
      if (url.endsWith('/patient-bookings/CQ-ABC123/im-here') && init?.method === 'POST') {
        const headers = new Headers(init.headers);
        expect(headers.get('Idempotency-Key')).toBeTruthy();
        return jsonResponse({ status: 'WAITING' });
      }
      return jsonResponse({ message: 'Unexpected request' }, 500);
    });

    const user = userEvent.setup();
    renderPage();
    expect(await screen.findByRole('button', { name: 'I’m here' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'I’m here' }));

    expect(await screen.findByRole('heading', { name: 'You are in the queue' })).toBeInTheDocument();
    expect(screen.getByText(/back in the queue/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'I’m here' })).not.toBeInTheDocument();
    await waitFor(() => expect(dashboardReads).toBe(2));
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3000/patient-bookings/CQ-ABC123/im-here',
      expect.objectContaining({ method: 'POST', credentials: 'include' }),
    );
  });

  it('keeps subscription or clinic unavailability neutral and confirms the appointment is not cancelled', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ message: 'Service unavailable' }, 503));
    renderPage();

    expect(await screen.findByRole('heading', { name: 'Your appointment is still booked.' })).toBeInTheDocument();
    expect(screen.getByText(/has not been cancelled/i)).toBeInTheDocument();
  });
});
