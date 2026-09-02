import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DoctorCalendarPage } from './DoctorCalendarPage';

function response(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

afterEach(() => vi.restoreAllMocks());

describe('DoctorCalendarPage', () => {
  it('loads clinic schedules and persists an unavailable date', async () => {
    const now = new Date();
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const workspace = {
      month,
      timeZone: 'Asia/Manila',
      rules: [],
      clinics: [
        {
          id: 'clinic-1',
          name: 'North Clinic',
          cityMunicipality: 'Davao City',
          timeZone: 'Asia/Manila',
          practiceSchedules: [
            {
              weekday: [
                'SUNDAY',
                'MONDAY',
                'TUESDAY',
                'WEDNESDAY',
                'THURSDAY',
                'FRIDAY',
                'SATURDAY',
              ][now.getDay()],
              opensAtLocal: '1970-01-01T08:00:00.000Z',
              closesAtLocal: '1970-01-01T12:00:00.000Z',
            },
          ],
        },
      ],
    };
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(response(workspace))
      .mockResolvedValueOnce(response({ date: now.toISOString().slice(0, 10), appointmentCount: 0, requiresPassword: false, clinics: [], appointments: [] }))
      .mockResolvedValueOnce(response({ rule: { id: 'rule-1' }, cancelledAppointmentCount: 0 }))
      .mockResolvedValueOnce(
        response({
          ...workspace,
          rules: [
            {
              id: 'rule-1',
              startDate: now.toISOString(),
              endDate: null,
              recurrenceType: 'SINGLE_DATE',
              customLabel: null,
            },
          ],
        }),
      );
    const user = userEvent.setup();
    render(<DoctorCalendarPage />);
    expect((await screen.findAllByText('North Clinic')).length).toBeGreaterThan(
      0,
    );
    await user.click(
      screen.getAllByRole('button', { name: /Mark Unavailable/ })[0],
    );
    await user.click(await screen.findByRole('button', { name: 'Confirm Unavailable Date' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    expect(fetchMock.mock.calls[1][0]).toContain(
      '/doctor-calendar/unavailable-dates/impact',
    );
    expect(await screen.findByText('● Unavailable')).toBeInTheDocument();
  });
});
