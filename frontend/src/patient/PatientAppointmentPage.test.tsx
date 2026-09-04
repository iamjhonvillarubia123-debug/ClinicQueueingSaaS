import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
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
  patientName: {
    firstName: 'Ana',
    middleName: null,
    lastName: 'Santos',
    suffix: null,
  },
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
        <Route
          path="/patient-bookings/:bookingReference"
          element={<PatientAppointmentPage />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe('C1 approved individual patient dashboard shell', () => {
  it('shows the approved waiting shell with permanent Queue Number and authoritative live queue values', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse(baseDashboard));

    renderPage();

    expect(
      await screen.findByRole('heading', { name: 'QUEUE IN PROGRESS' }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Queue number 7')).toHaveTextContent('007');
    expect(screen.getByText('Sunday, August 23, 2026')).toBeInTheDocument();

    const queueCard = screen
      .getByRole('heading', { name: 'QUEUE STATUS' })
      .closest('section');
    expect(queueCard).not.toBeNull();
    const queue = within(queueCard as HTMLElement);
    expect(queue.getByText('Now Serving').parentElement).toHaveTextContent('004');
    expect(queue.getByText('People Ahead').parentElement).toHaveTextContent('2');
    expect(queue.getByText('Estimated Wait').parentElement).toHaveTextContent('—');

    expect(screen.getByRole('heading', { name: 'ACTION AREA' })).toBeInTheDocument();
    expect(screen.getByText(/No action is needed right now/i)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3000/patient-bookings/CQ-ABC123/dashboard',
      expect.objectContaining({ credentials: 'include' }),
    );
  });

  it('shows only the current serving number while temporarily absent and offers I’M HERE only when backend-authorized', async () => {
    const absent = {
      ...baseDashboard,
      status: 'TEMPORARILY_ABSENT',
      canUseImHere: true,
      nowServingQueueNumber: 8,
      patientsAhead: null,
    };
    const waiting = {
      ...baseDashboard,
      status: 'WAITING',
      canUseImHere: false,
      nowServingQueueNumber: 8,
      patientsAhead: 3,
    };
    let dashboardReads = 0;
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith('/patient-bookings/CQ-ABC123/dashboard')) {
        dashboardReads += 1;
        return jsonResponse(dashboardReads === 1 ? absent : waiting);
      }
      if (
        url.endsWith('/patient-bookings/CQ-ABC123/im-here') &&
        init?.method === 'POST'
      ) {
        const headers = new Headers(init.headers);
        expect(headers.get('Idempotency-Key')).toBeTruthy();
        return jsonResponse({ status: 'WAITING' });
      }
      return jsonResponse({ message: 'Unexpected request' }, 500);
    });

    const user = userEvent.setup();
    renderPage();

    expect(
      await screen.findByRole('heading', { name: 'YOU MISSED YOUR TURN' }),
    ).toBeInTheDocument();
    const queueCard = screen
      .getByRole('heading', { name: 'QUEUE STATUS' })
      .closest('section');
    const queue = within(queueCard as HTMLElement);
    expect(queue.getByText('Now Serving').parentElement).toHaveTextContent('008');
    expect(queue.getByText('People Ahead').parentElement).toHaveTextContent('—');
    expect(queue.getByText('Estimated Wait').parentElement).toHaveTextContent('—');
    expect(queue.getByText('Not in queue.')).toBeInTheDocument();

    expect(screen.getByRole('button', { name: "I'M HERE" })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: "I'M HERE" }));

    expect(
      await screen.findByRole('heading', { name: 'QUEUE IN PROGRESS' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/YOU'RE BACK IN THE QUEUE/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: "I'M HERE" })).not.toBeInTheDocument();
    await waitFor(() => expect(dashboardReads).toBe(2));
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3000/patient-bookings/CQ-ABC123/im-here',
      expect.objectContaining({ method: 'POST', credentials: 'include' }),
    );
  });

  it('directs a second temporarily absent patient to clinic staff without self-service reinsertion', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({
        ...baseDashboard,
        status: 'TEMPORARILY_ABSENT',
        canUseImHere: false,
        nowServingQueueNumber: 8,
        patientsAhead: null,
      }),
    );

    renderPage();

    expect(
      await screen.findByRole('heading', { name: 'PLEASE SEE CLINIC STAFF' }),
    ).toBeInTheDocument();
    const actionArea = screen
      .getByRole('heading', { name: 'ACTION AREA' })
      .closest('section');
    expect(actionArea).not.toBeNull();
    expect(
      within(actionArea as HTMLElement).getByText(/reception desk for assistance/i),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /I'M HERE/i })).not.toBeInTheDocument();
  });

  it('shows the patient Queue Number as Now Serving when the appointment is called', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({
        ...baseDashboard,
        status: 'CALLED',
        nowServingQueueNumber: 7,
        patientsAhead: null,
      }),
    );

    renderPage();

    expect(
      await screen.findByRole('heading', { name: "IT'S YOUR TURN" }),
    ).toBeInTheDocument();
    const queueCard = screen
      .getByRole('heading', { name: 'QUEUE STATUS' })
      .closest('section');
    const queue = within(queueCard as HTMLElement);
    expect(queue.getByText('Now Serving').parentElement).toHaveTextContent('007');
    expect(queue.getByText('People Ahead').parentElement).toHaveTextContent('—');
    expect(queue.getByText('Estimated Wait').parentElement).toHaveTextContent('—');
  });

  it('does not promise that scheduled opening automatically starts the clinic', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({
        ...baseDashboard,
        clinicDayStatus: 'NOT_STARTED',
        nowServingQueueNumber: null,
        patientsAhead: 2,
      }),
    );

    renderPage();

    expect(
      await screen.findByRole('heading', { name: 'CLINIC NOT YET STARTED' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('The queue will appear here when the clinic starts.'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/will start at/i)).not.toBeInTheDocument();
  });

  it('keeps subscription or clinic unavailability neutral and confirms the appointment is not cancelled', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ message: 'Service unavailable' }, 503),
    );

    renderPage();

    expect(
      await screen.findByRole('heading', { name: 'Your appointment is still booked.' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/has not been cancelled/i)).toBeInTheDocument();
  });
});
