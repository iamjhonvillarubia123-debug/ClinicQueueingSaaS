import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { BookingRecoveryPage } from './BookingRecoveryPage';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const configuration = {
  practiceLocation: { publicIdentifier: 'clinic-public-id', name: 'North Clinic' },
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  sessionStorage.clear();
});

describe('F4 unified booking recovery', () => {
  it('uses the unified recovery endpoint and does not cancel on the first rejection click', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse(configuration))
      .mockResolvedValueOnce(jsonResponse({ recoveryAttemptId: '11111111-1111-4111-8111-111111111111', expiresAt: '2026-08-23T00:00:00.000Z' }))
      .mockResolvedValueOnce(jsonResponse({
        verified: true,
        recoveryAttemptId: '11111111-1111-4111-8111-111111111111',
        contextKind: 'INDIVIDUAL',
        candidate: {
          bookingReference: 'ABC123',
          queueNumber: 2,
          serviceDate: '2026-08-23T00:00:00.000Z',
          firstName: 'Mara',
          lastName: 'Santos',
          practiceLocationName: 'North Clinic',
        },
      }));

    render(<MemoryRouter initialEntries={['/recover/clinic-public-id']}><Routes><Route path="/recover/:publicIdentifier" element={<BookingRecoveryPage />} /></Routes></MemoryRouter>);

    await screen.findByRole('heading', { name: 'Recover your booking.' });
    fireEvent.change(screen.getByLabelText('Service date'), { target: { value: '2026-08-23' } });
    fireEvent.change(screen.getByLabelText('Mobile number'), { target: { value: '09171234567' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue to verification' }));

    await screen.findByRole('heading', { name: 'Verify your mobile.' });
    expect(fetchMock.mock.calls[1]?.[0]).toBe('http://localhost:3000/patient-booking-recovery/request');

    fireEvent.change(screen.getByLabelText('6-digit verification code'), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Verify code' }));

    expect(await screen.findByRole('heading', { name: 'Is this your booking?' })).toBeInTheDocument();
    expect(screen.getByText('August 23, 2026')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'This is not my booking' }));

    expect(await screen.findByRole('heading', { name: 'Cancel the existing booking and start again?' })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('requires the second destructive confirmation before authorizing replacement', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse(configuration))
      .mockResolvedValueOnce(jsonResponse({ recoveryAttemptId: '22222222-2222-4222-8222-222222222222', expiresAt: '2026-08-23T00:00:00.000Z' }))
      .mockResolvedValueOnce(jsonResponse({
        verified: true,
        recoveryAttemptId: '22222222-2222-4222-8222-222222222222',
        contextKind: 'BOOKING_GROUP',
        candidate: {
          bookingGroupId: 'group-id',
          serviceDate: '2026-08-23T00:00:00.000Z',
          practiceLocationName: 'North Clinic',
          appointments: [
            { bookingReference: 'G1', queueNumber: 4, firstName: 'Ana', lastName: 'Cruz', status: 'WAITING' },
            { bookingReference: 'G2', queueNumber: 5, firstName: 'Ben', lastName: 'Cruz', status: 'WAITING' },
          ],
        },
      }))
      .mockResolvedValueOnce(jsonResponse({
        replacementAuthorized: true,
        replacementRecoveryAttemptId: '22222222-2222-4222-8222-222222222222',
        expiresAt: '2026-08-22T23:59:00.000Z',
      }));

    render(<MemoryRouter initialEntries={['/recover/clinic-public-id']}><Routes><Route path="/recover/:publicIdentifier" element={<BookingRecoveryPage />} /></Routes></MemoryRouter>);

    await screen.findByRole('heading', { name: 'Recover your booking.' });
    fireEvent.change(screen.getByLabelText('Service date'), { target: { value: '2026-08-23' } });
    fireEvent.change(screen.getByLabelText('Mobile number'), { target: { value: '09171234567' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue to verification' }));
    await screen.findByRole('heading', { name: 'Verify your mobile.' });
    fireEvent.change(screen.getByLabelText('6-digit verification code'), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Verify code' }));
    await screen.findByRole('heading', { name: 'Is this your booking?' });
    fireEvent.click(screen.getByRole('button', { name: 'This is not my booking' }));
    await screen.findByRole('heading', { name: 'Cancel the existing booking and start again?' });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel existing booking and create new one' }));

    expect(await screen.findByRole('heading', { name: 'Existing booking cancelled.' })).toBeInTheDocument();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    expect(fetchMock.mock.calls[3]?.[0]).toBe('http://localhost:3000/patient-booking-recovery/22222222-2222-4222-8222-222222222222/replace-existing');
    expect(sessionStorage.getItem('f4-replacement:clinic-public-id')).toContain('22222222-2222-4222-8222-222222222222');
    expect(screen.getByText(/No second verification code is required/i)).toBeInTheDocument();
  });
});
