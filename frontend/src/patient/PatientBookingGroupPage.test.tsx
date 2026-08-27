import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { PatientBookingGroupPage } from './PatientBookingGroupPage';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const dashboard = {
  practiceLocationId: 'internal-location-id',
  serviceDate: '2026-08-23T00:00:00.000Z',
  servingProtectionEndedAt: null,
  visibleMemberCount: 2,
  members: [
    {
      bookingReference: 'CQ-AAA111',
      queueNumber: 2,
      status: 'WAITING',
      servingOrderKey: '2',
      waitingPlacementType: 'ORDINARY',
      firstName: 'Ana',
      middleName: null,
      lastName: 'Santos',
      suffix: null,
    },
    {
      bookingReference: 'CQ-BBB222',
      queueNumber: 3,
      status: 'TEMPORARILY_ABSENT',
      servingOrderKey: null,
      waitingPlacementType: null,
      firstName: 'Ben',
      middleName: null,
      lastName: 'Santos',
      suffix: null,
    },
  ],
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('F4 booking group controller dashboard', () => {
  it('shows every member as an independent appointment with a permanent Queue Number', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(dashboard));
    render(<MemoryRouter><PatientBookingGroupPage /></MemoryRouter>);

    expect(await screen.findByRole('heading', { name: '2 confirmed people' })).toBeInTheDocument();
    expect(screen.getByLabelText('Queue number 2')).toHaveTextContent('2');
    expect(screen.getByLabelText('Queue number 3')).toHaveTextContent('3');
    expect(screen.getByText('CQ-AAA111')).toBeInTheDocument();
    expect(screen.getByText('CQ-BBB222')).toBeInTheDocument();
    expect(screen.queryByText('internal-location-id')).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3000/patient-booking-groups/dashboard',
      expect.objectContaining({ credentials: 'include' }),
    );
  });

  it('directs temporarily absent group members to clinic staff and never offers I’m Here', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(dashboard));
    render(<MemoryRouter><PatientBookingGroupPage /></MemoryRouter>);

    expect(await screen.findByText(/cannot use I’m Here/i)).toBeInTheDocument();
    expect(screen.getByText(/approach clinic staff for reinsertion/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /I’m here/i })).not.toBeInTheDocument();
  });

  it('keeps missing controller access neutral', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ message: 'Booking group access is unavailable.' }, 401));
    render(<MemoryRouter><PatientBookingGroupPage /></MemoryRouter>);

    expect(await screen.findByRole('heading', { name: 'Group access is unavailable.' })).toBeInTheDocument();
    expect(screen.getByText(/does not currently have controller access/i)).toBeInTheDocument();
  });
});
