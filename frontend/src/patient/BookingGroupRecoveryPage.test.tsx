import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { BookingGroupRecoveryPage } from './BookingGroupRecoveryPage';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
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
    <MemoryRouter initialEntries={['/recover/group/north-clinic']}>
      <Routes>
        <Route path="/recover/group/:publicIdentifier" element={<BookingGroupRecoveryPage />} />
        <Route path="/patient-booking-groups" element={<div>Recovered group dashboard</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('F4 BookingGroup recovery', () => {
  it('keeps the request response privacy-neutral and proceeds to OTP verification', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith('/booking/public/configuration/north-clinic')) return jsonResponse(configuration);
      if (url.endsWith('/patient-booking-groups/recovery/request') && init?.method === 'POST') {
        expect(JSON.parse(String(init.body))).toEqual({
          practiceLocationPublicIdentifier: 'north-clinic',
          serviceDate: '2026-08-23',
          mobileNumber: '+639181234567',
        });
        return jsonResponse({
          message: 'If the booking group can be recovered, verification will continue.',
          recoveryAttemptId: 'attempt-1',
          expiresAt: '2026-08-23T01:00:00.000Z',
        });
      }
      return jsonResponse({ message: 'Unexpected request' }, 500);
    });

    const user = userEvent.setup();
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Recover access to your group booking.' })).toBeInTheDocument();
    await user.type(screen.getByLabelText('Service date'), '2026-08-23');
    await user.type(screen.getByLabelText('Controlling mobile number'), '+639181234567');
    await user.click(screen.getByRole('button', { name: 'Continue to verification' }));

    expect(await screen.findByRole('heading', { name: 'Verify the controlling mobile.' })).toBeInTheDocument();
    expect(screen.getByText(/If a matching group booking can be recovered/i)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3000/patient-booking-groups/recovery/request',
      expect.objectContaining({ method: 'POST', credentials: 'include' }),
    );
  });

  it('verifies OTP, completes credential rotation, and opens the existing group dashboard', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith('/booking/public/configuration/north-clinic')) return jsonResponse(configuration);
      if (url.endsWith('/patient-booking-groups/recovery/request')) {
        return jsonResponse({ message: 'neutral', recoveryAttemptId: 'attempt-1', expiresAt: '2026-08-23T01:00:00.000Z' });
      }
      if (url.endsWith('/patient-booking-groups/recovery/verify')) {
        expect(JSON.parse(String(init?.body))).toEqual({ recoveryAttemptId: 'attempt-1', otp: '123456' });
        return jsonResponse({ verified: true, recoveryAttemptId: 'attempt-1' });
      }
      if (url.endsWith('/patient-booking-groups/recovery/attempt-1/complete')) {
        const headers = new Headers(init?.headers);
        expect(headers.get('Idempotency-Key')).toBeTruthy();
        return jsonResponse({ replayed: false, accessRestored: true, credentialTransport: 'HTTP_ONLY_COOKIE' });
      }
      return jsonResponse({ message: 'Unexpected request' }, 500);
    });

    const user = userEvent.setup();
    renderPage();
    await screen.findByRole('heading', { name: 'Recover access to your group booking.' });
    await user.type(screen.getByLabelText('Service date'), '2026-08-23');
    await user.type(screen.getByLabelText('Controlling mobile number'), '+639181234567');
    await user.click(screen.getByRole('button', { name: 'Continue to verification' }));
    await user.type(await screen.findByLabelText('6-digit verification code'), '123456');
    await user.click(screen.getByRole('button', { name: 'Restore group access' }));

    expect(await screen.findByText('Recovered group dashboard')).toBeInTheDocument();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
  });

  it('resends through the same recovery attempt without putting recovery identifiers in the route', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith('/booking/public/configuration/north-clinic')) return jsonResponse(configuration);
      if (url.endsWith('/patient-booking-groups/recovery/request')) {
        return jsonResponse({ message: 'neutral', recoveryAttemptId: 'attempt-1', expiresAt: '2026-08-23T01:00:00.000Z' });
      }
      if (url.endsWith('/patient-booking-groups/recovery/attempt-1/resend')) return jsonResponse({ message: 'neutral', recoveryAttemptId: 'attempt-1' });
      return jsonResponse({ message: 'Unexpected request' }, 500);
    });

    const user = userEvent.setup();
    renderPage();
    await screen.findByRole('heading', { name: 'Recover access to your group booking.' });
    await user.type(screen.getByLabelText('Service date'), '2026-08-23');
    await user.type(screen.getByLabelText('Controlling mobile number'), '+639181234567');
    await user.click(screen.getByRole('button', { name: 'Continue to verification' }));
    await user.click(await screen.findByRole('button', { name: 'Send a new code' }));

    expect(await screen.findByText(/new verification code/i)).toBeInTheDocument();
    expect(window.location.href).not.toContain('attempt-1');
  });
});
