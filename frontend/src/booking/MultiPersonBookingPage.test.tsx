import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { BookingGroupAccessBoundary, MultiPersonBookingPage } from './MultiPersonBookingPage';

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

function renderGroupBooking() {
  return render(
    <MemoryRouter initialEntries={['/book/clinic-public/group']}>
      <Routes>
        <Route path="/book/:publicIdentifier/group" element={<MultiPersonBookingPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

async function fillTwoPeople(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByRole('heading', { name: 'Book 2–5 people at North Clinic' });
  await user.type(screen.getByLabelText('Service date'), '2026-08-24');
  await user.type(screen.getByLabelText('Controlling mobile number'), '+639171234567');

  const sections = document.querySelectorAll('.member-section');
  expect(sections).toHaveLength(2);

  const first = within(sections[0] as HTMLElement);
  await user.type(first.getByLabelText('First name'), 'Ana');
  await user.type(first.getByLabelText('Last name'), 'Santos');
  await user.click(first.getByRole('checkbox', { name: /General Consultation/ }));

  const second = within(sections[1] as HTMLElement);
  await user.type(second.getByLabelText('First name'), 'Ben');
  await user.type(second.getByLabelText('Last name'), 'Santos');
  await user.click(second.getByRole('checkbox', { name: /General Consultation/ }));

  await user.click(screen.getByRole('checkbox', { name: /I have read and acknowledge the Privacy Notice/ }));
}

describe('F3 multi-person public booking', () => {
  it('creates one multi-person draft with one controlling mobile and independent member services', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith('/booking/public/configuration/clinic-public')) return jsonResponse(config);
      if (url.includes('/booking/public/availability/clinic-public/')) return jsonResponse({ availableForPublicBooking: true });
      if (url.endsWith('/booking/public/draft/clinic-public') && init?.method === 'POST') {
        const body = JSON.parse(String(init.body));
        expect(body.mode).toBe('MULTI_PERSON');
        expect(body.mobileNumber).toBe('+639171234567');
        expect(body.members).toHaveLength(2);
        expect(body.members[0].firstName).toBe('Ana');
        expect(body.members[1].firstName).toBe('Ben');
        expect(body.members[0]).not.toHaveProperty('mobileNumber');
        expect(body.members[1]).not.toHaveProperty('mobileNumber');
        expect(body).not.toHaveProperty('practiceLocationId');
        return jsonResponse({
          bookingDraft: { id: 'group-draft', bookingReference: 'GD-1', expiresAt: '2026-08-24T10:30:00.000Z' },
          draftControlToken: 'group-control-token',
          otpVerification: { id: 'otp-id', expiresAt: '2026-08-24T10:05:00.000Z', maxAttempts: 5 },
        });
      }
      return jsonResponse({ message: 'Unexpected request' }, 500);
    });

    const user = userEvent.setup();
    renderGroupBooking();
    await fillTwoPeople(user);
    await user.click(screen.getByRole('button', { name: 'Continue to verification' }));

    expect(await screen.findByRole('heading', { name: 'Enter the 6-digit code' })).toBeInTheDocument();
    expect(sessionStorage.getItem('booking-draft:group-draft')).toBe('group-control-token');
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3000/booking/public/draft/clinic-public',
      expect.objectContaining({ method: 'POST', credentials: 'include' }),
    );
  });

  it('uses one OTP, confirms atomically, and never renders the raw group controller token', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith('/booking/public/configuration/clinic-public')) return jsonResponse(config);
      if (url.includes('/booking/public/availability/clinic-public/')) return jsonResponse({ availableForPublicBooking: true });
      if (url.endsWith('/booking/public/draft/clinic-public')) return jsonResponse({
        bookingDraft: { id: 'group-draft', bookingReference: 'GD-1', expiresAt: '2026-08-24T10:30:00.000Z' },
        draftControlToken: 'group-control-token',
        otpVerification: { id: 'otp-id', expiresAt: '2026-08-24T10:05:00.000Z', maxAttempts: 5 },
      });
      if (url.endsWith('/booking/verify-otp')) return jsonResponse({ verified: true });
      if (url.endsWith('/booking/draft/group-draft/confirm')) {
        const headers = new Headers(init?.headers);
        expect(headers.get('Idempotency-Key')).toBeTruthy();
        return jsonResponse({
          bookingGroup: {
            serviceDate: '2026-08-24T00:00:00.000Z',
            appointments: [
              { bookingReference: 'BR-A', queueNumber: 7, status: 'WAITING', firstName: 'Ana', lastName: 'Santos' },
              { bookingReference: 'BR-B', queueNumber: 8, status: 'WAITING', firstName: 'Ben', lastName: 'Santos' },
            ],
          },
          bookingGroupAccessToken: { expiresAt: '2026-08-25T00:00:00.000Z', transport: 'HTTP_ONLY_COOKIE' },
          replayed: false,
        });
      }
      return jsonResponse({ message: 'Unexpected request' }, 500);
    });

    const user = userEvent.setup();
    renderGroupBooking();
    await fillTwoPeople(user);
    await user.click(screen.getByRole('button', { name: 'Continue to verification' }));
    await screen.findByRole('heading', { name: 'Enter the 6-digit code' });
    await user.type(screen.getByLabelText('Verification code'), '123456');
    await user.click(screen.getByRole('button', { name: 'Verify code' }));
    expect(await screen.findByRole('heading', { name: 'Check all 2 people' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Confirm group booking' }));
    expect(await screen.findByRole('heading', { name: 'Your group booking is confirmed.' })).toBeInTheDocument();
    expect(screen.getByText('Queue 7')).toBeInTheDocument();
    expect(screen.getByText('Queue 8')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View group booking' })).toHaveAttribute('href', '/patient-booking-groups');
    expect(screen.queryByText('group-control-token')).not.toBeInTheDocument();
    expect(screen.queryByText(/bookingGroupAccessToken/i)).not.toBeInTheDocument();
    await waitFor(() => expect(sessionStorage.getItem('booking-draft:group-draft')).toBeNull());
  });

  it('opens the controller surface through cookie-backed group access', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({
      serviceDate: '2026-08-24T00:00:00.000Z',
      visibleMemberCount: 2,
      members: [
        { bookingReference: 'BR-A', queueNumber: 7, status: 'WAITING', firstName: 'Ana', lastName: 'Santos' },
        { bookingReference: 'BR-B', queueNumber: 8, status: 'WAITING', firstName: 'Ben', lastName: 'Santos' },
      ],
    }));

    render(<MemoryRouter><BookingGroupAccessBoundary /></MemoryRouter>);
    expect(await screen.findByRole('heading', { name: '2 confirmed people' })).toBeInTheDocument();
    expect(screen.getByText('Queue 7')).toBeInTheDocument();
    expect(screen.getByText('Queue 8')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3000/patient-booking-groups/dashboard',
      expect.objectContaining({ credentials: 'include' }),
    );
  });
});
