import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AppointmentRecoveryPage } from './AppointmentRecoveryPage';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const configuration = {
  practiceLocation: { publicIdentifier: 'north-clinic', name: 'North Clinic' },
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/recover/appointment/north-clinic']}>
      <Routes>
        <Route path="/recover/appointment/:publicIdentifier" element={<AppointmentRecoveryPage />} />
        <Route path="/patient-bookings/:bookingReference" element={<div>Recovered appointment dashboard</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('F4 individual Appointment recovery', () => {
  it('does not reveal a candidate before OTP verification and then requires explicit candidate confirmation', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith('/booking/public/configuration/north-clinic')) return jsonResponse(configuration);
      if (url.endsWith('/patient-bookings/recovery/request')) {
        expect(JSON.parse(String(init?.body))).toEqual({
          practiceLocationPublicIdentifier: 'north-clinic',
          serviceDate: '2026-08-23',
          mobileNumber: '+639171234567',
        });
        return jsonResponse({ recoveryAttemptId: 'attempt-1' });
      }
      if (url.endsWith('/patient-bookings/recovery/verify')) {
        return jsonResponse({
          verified: true,
          recoveryAttemptId: 'attempt-1',
          candidate: {
            bookingReference: 'CQ-G3X2C2',
            queueNumber: 1,
            serviceDate: '2026-08-23T00:00:00.000Z',
            firstName: 'test',
            lastName: 'name',
            practiceLocationName: 'North Clinic',
          },
        });
      }
      return jsonResponse({ message: 'Unexpected request' }, 500);
    });

    const user = userEvent.setup();
    renderPage();
    await screen.findByRole('heading', { name: 'Recover access to your appointment.' });
    expect(screen.queryByText('CQ-G3X2C2')).not.toBeInTheDocument();

    await user.type(screen.getByLabelText('Service date'), '2026-08-23');
    await user.type(screen.getByLabelText('Mobile number'), '+639171234567');
    await user.click(screen.getByRole('button', { name: 'Continue to verification' }));
    expect(await screen.findByRole('heading', { name: 'Verify your mobile.' })).toBeInTheDocument();
    expect(screen.queryByText('CQ-G3X2C2')).not.toBeInTheDocument();

    await user.type(screen.getByLabelText('6-digit verification code'), '123456');
    await user.click(screen.getByRole('button', { name: 'Verify code' }));

    expect(await screen.findByText('CQ-G3X2C2')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'This is my booking' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'This is not my booking' })).toBeInTheDocument();
  });

  it('rejects the candidate without navigating to appointment access', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith('/booking/public/configuration/north-clinic')) return jsonResponse(configuration);
      if (url.endsWith('/patient-bookings/recovery/request')) return jsonResponse({ recoveryAttemptId: 'attempt-1' });
      if (url.endsWith('/patient-bookings/recovery/verify')) {
        return jsonResponse({
          verified: true,
          recoveryAttemptId: 'attempt-1',
          candidate: {
            bookingReference: 'CQ-G3X2C2',
            queueNumber: 1,
            serviceDate: '2026-08-23T00:00:00.000Z',
            firstName: 'test',
            lastName: 'name',
            practiceLocationName: 'North Clinic',
          },
        });
      }
      if (url.endsWith('/patient-bookings/recovery/attempt-1/reject')) return jsonResponse({ rejected: true });
      return jsonResponse({ message: 'Unexpected request' }, 500);
    });

    const user = userEvent.setup();
    renderPage();
    await screen.findByRole('heading', { name: 'Recover access to your appointment.' });
    await user.type(screen.getByLabelText('Service date'), '2026-08-23');
    await user.type(screen.getByLabelText('Mobile number'), '+639171234567');
    await user.click(screen.getByRole('button', { name: 'Continue to verification' }));
    await user.type(await screen.findByLabelText('6-digit verification code'), '123456');
    await user.click(screen.getByRole('button', { name: 'Verify code' }));
    await user.click(await screen.findByRole('button', { name: 'This is not my booking' }));

    expect(await screen.findByRole('heading', { name: 'No booking was changed.' })).toBeInTheDocument();
    expect(screen.queryByText('Recovered appointment dashboard')).not.toBeInTheDocument();
  });
});
