import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiRequest } from '../api/client';
import { ClinicTabPage } from './ClinicTab';

vi.mock('../api/client', () => ({ apiRequest: vi.fn() }));

const apiRequestMock = vi.mocked(apiRequest);

const location = {
  id: 'location-1',
  lifecycleStatus: 'DRAFT',
  name: 'Saved Clinic',
  addressLine1: 'Main Street',
  contactNumber: null,
  countryCode: 'PH',
  timeZone: 'Asia/Manila',
  practiceSchedules: [
    {
      weekday: 'MONDAY',
      isOpen: true,
      opensAtLocal: '1970-01-01T09:15:00.000Z',
      closesAtLocal: '1970-01-01T13:30:00.000Z',
      maximumOnlineBookingUntilLocal: '1970-01-01T11:30:00.000Z',
      maximumOperatingUntilLocal: '1970-01-01T14:30:00.000Z',
    },
  ],
};

afterEach(cleanup);

describe('ClinicTabPage draft schedule persistence', () => {
  beforeEach(() => {
    apiRequestMock.mockReset();
    apiRequestMock.mockImplementation(async (path, options) => {
      if (path === '/practice-location' && !options) return [location] as never;
      if (path === '/practice-location' && options?.method === 'POST')
        return location as never;
      if (
        path === '/practice-location/location-1' &&
        options?.method === 'PATCH'
      )
        return location as never;
      if (
        path === '/practice-location/location-1/draft-schedule' &&
        options?.method === 'PUT'
      )
        return [] as never;
      throw new Error(`Unexpected API request: ${path}`);
    });
  });

  it('loads persisted hours and sends all schedule values when Save as Draft is selected', async () => {
    const user = userEvent.setup();
    render(<ClinicTabPage />);

    await user.click(
      await screen.findByRole('button', { name: 'Edit Clinic' }),
    );
    await user.click(screen.getByRole('button', { name: 'Save and Continue' }));

    expect(screen.getByLabelText('Monday opening time')).toHaveValue(
      '09:15 AM',
    );
    expect(screen.getByLabelText('Monday closing time')).toHaveValue(
      '01:30 PM',
    );
    expect(screen.getByLabelText('Monday maximum operating time')).toHaveValue(
      '02:30 PM',
    );

    await user.click(
      screen.getByRole('button', { name: 'Choose save action' }),
    );
    await user.click(screen.getByRole('menuitem', { name: /Save as Draft/ }));
    await user.click(screen.getByRole('button', { name: 'Save as Draft' }));

    await waitFor(() =>
      expect(apiRequestMock).toHaveBeenCalledWith(
        '/practice-location/location-1/draft-schedule',
        expect.objectContaining({
          method: 'PUT',
          body: expect.objectContaining({
            schedules: expect.arrayContaining([
              expect.objectContaining({
                weekday: 'MONDAY',
                isOpen: true,
                opensAtLocal: '09:15',
                closesAtLocal: '13:30',
                maximumOnlineBookingUntilLocal: '11:30',
                maximumOperatingUntilLocal: '14:30',
              }),
            ]),
          }),
        }),
      ),
    );
  });

  it('changes the clinic main action when a dropdown action is selected without executing it', async () => {
    const user = userEvent.setup();
    render(<ClinicTabPage />);

    await user.click(
      await screen.findByRole('button', {
        name: 'More actions for Saved Clinic',
      }),
    );
    await user.click(screen.getByRole('menuitem', { name: /Activate Clinic/ }));

    expect(screen.getByRole('button', { name: 'Activate Clinic' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Clinics' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Activate Clinic' }));
    expect(screen.getByRole('heading', { name: 'Clinics' })).toBeInTheDocument();
  });

  it('loads the saved doctor schedule draft instead of the live schedule for an ACTIVE clinic', async () => {
    apiRequestMock.mockImplementation(async (path, options) => {
      if (path === '/practice-location' && !options)
        return [
          {
            ...location,
            lifecycleStatus: 'ACTIVE',
            doctorScheduleDraft: {
              schedules: [
                {
                  ...location.practiceSchedules[0],
                  opensAtLocal: '1970-01-01T10:45:00.000Z',
                  closesAtLocal: '1970-01-01T15:15:00.000Z',
                  maximumOnlineBookingUntilLocal: '1970-01-01T13:15:00.000Z',
                  maximumOperatingUntilLocal: '1970-01-01T16:00:00.000Z',
                },
              ],
            },
          },
        ] as never;
      throw new Error(`Unexpected API request: ${path}`);
    });

    const user = userEvent.setup();
    render(<ClinicTabPage />);

    await user.click(
      await screen.findByRole('button', {
        name: 'More actions for Saved Clinic',
      }),
    );
    await user.click(screen.getByRole('menuitem', { name: /Edit Clinic/ }));

    expect(screen.getByRole('heading', { name: 'Clinics' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Edit Clinic' }));
    await user.click(screen.getByRole('button', { name: 'Save and Continue' }));

    expect(screen.getByLabelText('Monday opening time')).toHaveValue(
      '10:45 AM',
    );
    expect(screen.getByLabelText('Monday closing time')).toHaveValue(
      '03:15 PM',
    );
    expect(screen.getByLabelText('Monday maximum operating time')).toHaveValue(
      '04:00 PM',
    );
  });
});
