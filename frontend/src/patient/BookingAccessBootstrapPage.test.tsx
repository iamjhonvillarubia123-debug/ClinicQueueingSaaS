import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { BookingAccessBootstrapPage } from './BookingAccessBootstrapPage';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.history.replaceState(null, '', '/');
});

describe('secure Appointment access bootstrap', () => {
  it('removes the fragment token before establishing the HttpOnly cookie and opening the appointment', async () => {
    window.history.replaceState(null, '', '/booking/access#token=secret-fragment-token');
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ bookingReference: 'CQ-G3X2C2', expiresAt: '2026-08-30T00:00:00.000Z' }),
    );

    render(
      <MemoryRouter initialEntries={['/booking/access']}>
        <Routes>
          <Route path="/booking/access" element={<BookingAccessBootstrapPage />} />
          <Route path="/patient-bookings/:bookingReference" element={<div>Appointment opened</div>} />
        </Routes>
      </MemoryRouter>,
    );

    expect(window.location.hash).toBe('');
    expect(await screen.findByText('Appointment opened')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3000/patient-bookings/access',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify({ token: 'secret-fragment-token' }),
      }),
    );
  });
});
