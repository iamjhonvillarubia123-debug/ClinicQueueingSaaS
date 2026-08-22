import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { IndividualBookingPage } from './IndividualBookingPage';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const config = {
  practiceLocation: { publicIdentifier: 'clinic-public', name: 'North Clinic', timeZone: 'Asia/Manila' },
  bookingWindow: { maximumAdvanceBookingDays: 30, upperBoundaryInclusive: true },
  services: [{ id: 'service-id', name: 'General Consultation', durationMinutes: 30 }],
  bookingQuestions: [],
  serviceSelection: { maximumSelections: 3 },
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  sessionStorage.clear();
});

function renderBooking() {
  return render(
    <MemoryRouter initialEntries={['/book/clinic-public']}>
      <Routes>
        <Route path="/book/:publicIdentifier" element={<IndividualBookingPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('F2 individual public booking', () => {
  it('renders the public booking configuration without requiring an internal PracticeLocation id', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(config));
    renderBooking();

    expect(await screen.findByRole('heading', { name: 'Book at North Clinic' })).toBeInTheDocument();
    expect(screen.getByText('General Consultation')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3000/booking/public/configuration/clinic-public',
      expect.objectContaining({ credentials: 'include' }),
    );
  });

  it('moves from patient details to OTP verification using the public clinic identifier', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith('/booking/public/configuration/clinic-public')) return jsonResponse(config);
      if (url.includes('/booking/public/availability/clinic-public/')) {
        return jsonResponse({ serviceDate: '2026-08-24', availableForPublicBooking: true, reason: 'AVAILABLE' });
      }
      if (url.endsWith('/booking/public/draft/clinic-public') && init?.method === 'POST') {
        const body = JSON.parse(String(init.body));
        expect(body).not.toHaveProperty('practiceLocationId');
        expect(body.privacyNoticeVersion).toBe('v1.0-2026-08');
        return jsonResponse({
          bookingDraft: { id: 'draft-id', bookingReference: 'BR-123', expiresAt: '2026-08-24T10:30:00.000Z' },
          draftControlToken: 'draft-control-token',
          otpVerification: { id: 'otp-id', expiresAt: '2026-08-24T10:05:00.000Z', maxAttempts: 5 },
        });
      }
      return jsonResponse({ message: 'Unexpected request' }, 500);
    });

    const user = userEvent.setup();
    renderBooking();
    await screen.findByRole('heading', { name: 'Book at North Clinic' });

    await user.type(screen.getByLabelText('Service date'), '2026-08-24');
    await user.click(screen.getByRole('checkbox', { name: /General Consultation/ }));
    await user.type(screen.getByLabelText('First name'), 'Ana');
    await user.type(screen.getByLabelText('Last name'), 'Santos');
    await user.type(screen.getByLabelText('Mobile number'), '+639171234567');
    await user.click(screen.getByRole('checkbox', { name: /I have read and acknowledge the Privacy Notice/ }));
    await user.click(screen.getByRole('button', { name: 'Continue to verification' }));

    expect(await screen.findByRole('heading', { name: 'Enter the 6-digit code' })).toBeInTheDocument();
    expect(sessionStorage.getItem('booking-draft:draft-id')).toBe('draft-control-token');
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3000/booking/public/draft/clinic-public',
      expect.objectContaining({ method: 'POST', credentials: 'include' }),
    );
  });

  it('verifies OTP, confirms with idempotency, and never renders a raw booking access token', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith('/booking/public/configuration/clinic-public')) return jsonResponse(config);
      if (url.includes('/booking/public/availability/clinic-public/')) return jsonResponse({ availableForPublicBooking: true });
      if (url.endsWith('/booking/public/draft/clinic-public')) return jsonResponse({
        bookingDraft: { id: 'draft-id', bookingReference: 'BR-123', expiresAt: '2026-08-24T10:30:00.000Z' },
        draftControlToken: 'draft-control-token',
        otpVerification: { id: 'otp-id', expiresAt: '2026-08-24T10:05:00.000Z', maxAttempts: 5 },
      });
      if (url.endsWith('/booking/verify-otp')) return jsonResponse({ verified: true });
      if (url.endsWith('/booking/draft/draft-id/confirm')) {
        const headers = new Headers(init?.headers);
        expect(headers.get('Idempotency-Key')).toBeTruthy();
        return jsonResponse({
          appointment: { bookingReference: 'BR-123', queueNumber: 7, serviceDate: '2026-08-24T00:00:00.000Z', status: 'WAITING' },
          bookingAccessToken: { expiresAt: '2026-08-25T00:00:00.000Z', transport: 'HTTP_ONLY_COOKIE' },
          replayed: false,
        });
      }
      return jsonResponse({ message: 'Unexpected request' }, 500);
    });

    const user = userEvent.setup();
    renderBooking();
    await screen.findByRole('heading', { name: 'Book at North Clinic' });
    await user.type(screen.getByLabelText('Service date'), '2026-08-24');
    await user.click(screen.getByRole('checkbox', { name: /General Consultation/ }));
    await user.type(screen.getByLabelText('First name'), 'Ana');
    await user.type(screen.getByLabelText('Last name'), 'Santos');
    await user.type(screen.getByLabelText('Mobile number'), '+639171234567');
    await user.click(screen.getByRole('checkbox', { name: /I have read and acknowledge the Privacy Notice/ }));
    await user.click(screen.getByRole('button', { name: 'Continue to verification' }));
    await screen.findByRole('heading', { name: 'Enter the 6-digit code' });

    await user.type(screen.getByLabelText('Verification code'), '123456');
    await user.click(screen.getByRole('button', { name: 'Verify code' }));
    expect(await screen.findByRole('heading', { name: 'Check your booking' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Confirm appointment' }));
    expect(await screen.findByRole('heading', { name: 'Your appointment is booked.' })).toBeInTheDocument();
    expect(screen.getByText('7')).toBeInTheDocument();
    expect(screen.getByText('BR-123')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View appointment' })).toHaveAttribute('href', '/patient-bookings/BR-123');
    expect(screen.queryByText('draft-control-token')).not.toBeInTheDocument();
    expect(screen.queryByText(/bookingAccessToken/i)).not.toBeInTheDocument();
    await waitFor(() => expect(sessionStorage.getItem('booking-draft:draft-id')).toBeNull());
  });

  it('uses verified replacement authority and confirms without a second OTP', async () => {
    sessionStorage.setItem('f4-replacement:clinic-public', JSON.stringify({
      recoveryAttemptId: '11111111-1111-4111-8111-111111111111',
      serviceDate: '2026-08-24',
      mobileNumber: '09171234567',
      expiresAt: '2099-08-24T10:10:00.000Z',
    }));

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith('/booking/public/configuration/clinic-public')) return jsonResponse(config);
      if (url.endsWith('/booking/public/availability/clinic-public/2026-08-24')) return jsonResponse({ availableForPublicBooking: true });
      if (url.endsWith('/booking/public/draft/clinic-public') && init?.method === 'POST') {
        const body = JSON.parse(String(init.body));
        expect(body.replacementRecoveryAttemptId).toBe('11111111-1111-4111-8111-111111111111');
        return jsonResponse({
          bookingDraft: { id: 'replacement-draft', bookingReference: 'NEW-1', expiresAt: '2099-08-24T10:30:00.000Z' },
          draftControlToken: 'replacement-control',
          otpVerification: { verified: true, replacementAuthorized: true, expiresAt: '2099-08-24T10:10:00.000Z' },
        });
      }
      if (url.endsWith('/booking/draft/replacement-draft/confirm')) return jsonResponse({
        appointment: { bookingReference: 'NEW-1', queueNumber: 12, serviceDate: '2026-08-24T00:00:00.000Z', status: 'WAITING' },
        bookingAccessToken: { expiresAt: '2026-08-25T00:00:00.000Z', transport: 'HTTP_ONLY_COOKIE' },
        replayed: false,
      });
      return jsonResponse({ message: 'Unexpected request' }, 500);
    });

    const user = userEvent.setup();
    renderBooking();
    await screen.findByRole('heading', { name: 'Book at North Clinic' });
    expect(screen.getByLabelText('Service date')).toHaveValue('2026-08-24');
    expect(screen.getByLabelText('Mobile number')).toHaveValue('09171234567');
    expect(screen.queryByText('Verify')).not.toBeInTheDocument();

    await user.click(screen.getByRole('checkbox', { name: /General Consultation/ }));
    await user.type(screen.getByLabelText('First name'), 'Ana');
    await user.type(screen.getByLabelText('Last name'), 'Santos');
    await user.click(screen.getByRole('checkbox', { name: /I have read and acknowledge the Privacy Notice/ }));
    await user.click(screen.getByRole('button', { name: 'Review new booking' }));

    expect(await screen.findByRole('heading', { name: 'Check your booking' })).toBeInTheDocument();
    expect(screen.getByText('08/24/2026')).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/booking/verify-otp'))).toBe(false);

    await user.click(screen.getByRole('button', { name: 'Confirm new appointment' }));
    expect(await screen.findByRole('heading', { name: 'Your appointment is booked.' })).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/booking/verify-otp'))).toBe(false);
    expect(sessionStorage.getItem('f4-replacement:clinic-public')).toBeNull();
  });
});
