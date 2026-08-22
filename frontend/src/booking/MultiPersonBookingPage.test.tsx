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

const groupDraftResult = {
  bookingDraft: { id: 'group-draft', bookingReference: 'GD-1', expiresAt: '2026-08-24T10:30:00.000Z' },
  draftControlToken: 'group-control-token',
  otpVerification: { id: 'otp-id', expiresAt: '2026-08-24T10:05:00.000Z', maxAttempts: 5 },
};

const duplicateGroup = {
  duplicate: true,
  replacementAuthorized: false,
  context: {
    kind: 'BOOKING_GROUP',
    bookingGroup: {
      id: 'old-group',
      serviceDate: '2026-08-24T00:00:00.000Z',
      practiceLocation: { name: 'North Clinic' },
      appointments: [
        { bookingReference: 'OLD-A', queueNumber: 3, firstName: 'Mara', lastName: 'Santos', status: 'WAITING' },
        { bookingReference: 'OLD-B', queueNumber: 4, firstName: 'Nico', lastName: 'Santos', status: 'WAITING' },
      ],
    },
  },
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
        <Route path="/patient-booking-groups" element={<div>Group dashboard</div>} />
        <Route path="/patient-bookings/:bookingReference" element={<div>Appointment dashboard</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

async function fillTwoPeople(user: ReturnType<typeof userEvent.setup>, sharedAlreadyFilled = false) {
  await screen.findByRole('heading', { name: 'Book 2–5 people at North Clinic' });
  if (!sharedAlreadyFilled) {
    await user.type(screen.getByLabelText('Service date'), '2026-08-24');
    await user.type(screen.getByLabelText('Controlling mobile number'), '+639171234567');
  }

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

async function createAndVerifyGroup(user: ReturnType<typeof userEvent.setup>) {
  await fillTwoPeople(user);
  await user.click(screen.getByRole('button', { name: 'Continue to verification' }));
  await screen.findByRole('heading', { name: 'Enter the 6-digit code' });
  await user.type(screen.getByLabelText('Verification code'), '123456');
  await user.click(screen.getByRole('button', { name: 'Verify code' }));
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
        return jsonResponse(groupDraftResult);
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

  it('uses one OTP, checks duplicate context, confirms atomically, and never renders the raw group controller token', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith('/booking/public/configuration/clinic-public')) return jsonResponse(config);
      if (url.includes('/booking/public/availability/clinic-public/')) return jsonResponse({ availableForPublicBooking: true });
      if (url.endsWith('/booking/public/draft/clinic-public')) return jsonResponse(groupDraftResult);
      if (url.endsWith('/booking/verify-otp')) return jsonResponse({ verified: true });
      if (url.endsWith('/booking/draft/group-draft/duplicate-context')) return jsonResponse({ duplicate: false, replacementAuthorized: false });
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
    await createAndVerifyGroup(user);
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

  it('preserves the verified group draft and restores an existing group controller without creating a new group', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith('/booking/public/configuration/clinic-public')) return jsonResponse(config);
      if (url.includes('/booking/public/availability/clinic-public/')) return jsonResponse({ availableForPublicBooking: true });
      if (url.endsWith('/booking/public/draft/clinic-public')) return jsonResponse(groupDraftResult);
      if (url.endsWith('/booking/verify-otp')) return jsonResponse({ verified: true });
      if (url.endsWith('/booking/draft/group-draft/duplicate-context')) return jsonResponse(duplicateGroup);
      if (url.endsWith('/booking/draft/group-draft/use-existing')) return jsonResponse({
        contextKind: 'BOOKING_GROUP',
        bookingGroupId: 'old-group',
        bookingGroupAccessToken: { expiresAt: '2026-08-31T00:00:00.000Z', transport: 'HTTP_ONLY_COOKIE' },
      });
      return jsonResponse({ message: 'Unexpected request' }, 500);
    });

    const user = userEvent.setup();
    renderGroupBooking();
    await createAndVerifyGroup(user);

    expect(await screen.findByRole('heading', { name: 'Is this your booking?' })).toBeInTheDocument();
    expect(screen.getByText('August 24, 2026')).toBeInTheDocument();
    expect(screen.getByText(/Mara Santos · Queue 3/)).toBeInTheDocument();
    expect(sessionStorage.getItem('booking-draft:group-draft')).toBe('group-control-token');

    await user.click(screen.getByRole('button', { name: 'Yes, this is my booking' }));
    expect(await screen.findByText('Group dashboard')).toBeInTheDocument();
    expect(sessionStorage.getItem('booking-draft:group-draft')).toBeNull();
    expect(fetchMock.mock.calls.some(([input]) => String(input).endsWith('/booking/draft/group-draft/confirm'))).toBe(false);
  });

  it('keeps the first rejection non-destructive and replaces the existing group with the same verified draft without another OTP', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith('/booking/public/configuration/clinic-public')) return jsonResponse(config);
      if (url.includes('/booking/public/availability/clinic-public/')) return jsonResponse({ availableForPublicBooking: true });
      if (url.endsWith('/booking/public/draft/clinic-public')) return jsonResponse(groupDraftResult);
      if (url.endsWith('/booking/verify-otp')) return jsonResponse({ verified: true });
      if (url.endsWith('/booking/draft/group-draft/duplicate-context')) return jsonResponse(duplicateGroup);
      if (url.endsWith('/booking/draft/group-draft/replace-existing')) return jsonResponse({ replacementAuthorized: true, expiresAt: '2026-08-24T10:10:00.000Z' });
      if (url.endsWith('/booking/draft/group-draft/confirm')) return jsonResponse({
        bookingGroup: {
          serviceDate: '2026-08-24T00:00:00.000Z',
          appointments: [
            { bookingReference: 'NEW-A', queueNumber: 15, status: 'WAITING', firstName: 'Ana', lastName: 'Santos' },
            { bookingReference: 'NEW-B', queueNumber: 16, status: 'WAITING', firstName: 'Ben', lastName: 'Santos' },
          ],
        },
        bookingGroupAccessToken: { expiresAt: '2026-08-31T00:00:00.000Z', transport: 'HTTP_ONLY_COOKIE' },
        replayed: false,
      });
      return jsonResponse({ message: 'Unexpected request' }, 500);
    });

    const user = userEvent.setup();
    renderGroupBooking();
    await createAndVerifyGroup(user);
    await screen.findByRole('heading', { name: 'Is this your booking?' });

    const callsBeforeNo = fetchMock.mock.calls.length;
    await user.click(screen.getByRole('button', { name: 'No, I need a different booking' }));
    expect(await screen.findByRole('heading', { name: 'Cancel the existing booking and create a new one?' })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(callsBeforeNo);
    expect(sessionStorage.getItem('booking-draft:group-draft')).toBe('group-control-token');

    await user.click(screen.getByRole('button', { name: 'Cancel existing booking and create new one' }));
    expect(await screen.findByRole('heading', { name: 'Check all 2 people' })).toBeInTheDocument();
    expect(fetchMock.mock.calls.filter(([input]) => String(input).endsWith('/booking/verify-otp'))).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: 'Confirm new group booking' }));
    expect(await screen.findByRole('heading', { name: 'Your group booking is confirmed.' })).toBeInTheDocument();
    expect(screen.getByText('Queue 15')).toBeInTheDocument();
    expect(screen.getByText('Queue 16')).toBeInTheDocument();
    expect(fetchMock.mock.calls.filter(([input]) => String(input).endsWith('/booking/verify-otp'))).toHaveLength(1);
  });

  it('uses verified manual-recovery replacement authority for a group and does not request a second OTP', async () => {
    sessionStorage.setItem('f4-replacement:clinic-public', JSON.stringify({
      recoveryAttemptId: '22222222-2222-4222-8222-222222222222',
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
        expect(body.replacementRecoveryAttemptId).toBe('22222222-2222-4222-8222-222222222222');
        expect(body.mode).toBe('MULTI_PERSON');
        return jsonResponse({
          bookingDraft: { id: 'replacement-group-draft', bookingReference: 'GD-NEW', expiresAt: '2099-08-24T10:30:00.000Z' },
          draftControlToken: 'replacement-group-control',
          otpVerification: { verified: true, replacementAuthorized: true, expiresAt: '2099-08-24T10:10:00.000Z' },
        });
      }
      if (url.endsWith('/booking/draft/replacement-group-draft/confirm')) return jsonResponse({
        bookingGroup: {
          serviceDate: '2026-08-24T00:00:00.000Z',
          appointments: [
            { bookingReference: 'NEW-A', queueNumber: 15, status: 'WAITING', firstName: 'Ana', lastName: 'Santos' },
            { bookingReference: 'NEW-B', queueNumber: 16, status: 'WAITING', firstName: 'Ben', lastName: 'Santos' },
          ],
        },
        bookingGroupAccessToken: { expiresAt: '2026-08-25T00:00:00.000Z', transport: 'HTTP_ONLY_COOKIE' },
        replayed: false,
      });
      return jsonResponse({ message: 'Unexpected request' }, 500);
    });

    const user = userEvent.setup();
    renderGroupBooking();
    await screen.findByRole('heading', { name: 'Book 2–5 people at North Clinic' });
    expect(screen.getByLabelText('Service date')).toHaveValue('2026-08-24');
    expect(screen.getByLabelText('Controlling mobile number')).toHaveValue('09171234567');
    await fillTwoPeople(user, true);
    await user.click(screen.getByRole('button', { name: 'Review new group booking' }));

    expect(await screen.findByRole('heading', { name: 'Check all 2 people' })).toBeInTheDocument();
    expect(screen.getByText('08/24/2026')).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/booking/verify-otp'))).toBe(false);

    await user.click(screen.getByRole('button', { name: 'Confirm new group booking' }));
    expect(await screen.findByRole('heading', { name: 'Your group booking is confirmed.' })).toBeInTheDocument();
    expect(screen.getByText('Queue 15')).toBeInTheDocument();
    expect(screen.getByText('Queue 16')).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/booking/verify-otp'))).toBe(false);
    expect(sessionStorage.getItem('f4-replacement:clinic-public')).toBeNull();
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
