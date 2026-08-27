import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiRequest } from '../api/client';
import { ClinicTabPage } from './ClinicTab';

vi.mock('../api/client', () => ({ apiRequest: vi.fn() }));

const apiRequestMock = vi.mocked(apiRequest);

const effectiveLocation = {
  id: 'location-active-1',
  lifecycleStatus: 'ACTIVE',
  name: 'Effective Clinic',
  shortCode: 'EFF',
  addressLine1: 'Effective Street',
  contactNumber: null,
  clinicEmail: null,
  clinicDescription: null,
  countryCode: 'PH',
  timeZone: 'Asia/Manila',
  services: [
    {
      id: 'service-effective-1',
      sourceDoctorServiceTemplateId: null,
      name: 'General Consultation',
      description: 'Effective wording',
      durationMinutes: 30,
      status: 'ACTIVE',
    },
  ],
  bookingQuestions: [],
  practiceSchedules: [
    {
      weekday: 'MONDAY',
      isOpen: true,
      opensAtLocal: '1970-01-01T08:00:00.000Z',
      closesAtLocal: '1970-01-01T17:00:00.000Z',
      maximumOnlineBookingUntilLocal: '1970-01-01T15:00:00.000Z',
      maximumOperatingUntilLocal: '1970-01-01T18:00:00.000Z',
    },
  ],
  doctorScheduleDraft: null,
};

afterEach(cleanup);

describe('ACTIVE clinic whole-configuration draft recovery', () => {
  beforeEach(() => {
    apiRequestMock.mockReset();
  });

  it('recovers the last saved Service draft on reopen without replacing the effective clinic values', async () => {
    let draftSaved = false;
    let savedServiceName = '';
    let savedServiceDescription = '';

    apiRequestMock.mockImplementation(async (path, options) => {
      if (path === '/practice-location' && !options) {
        if (!draftSaved) return [effectiveLocation] as never;
        return [
          {
            ...effectiveLocation,
            doctorScheduleDraft: {
              name: effectiveLocation.name,
              shortCode: effectiveLocation.shortCode,
              addressLine1: effectiveLocation.addressLine1,
              contactNumber: null,
              clinicEmail: null,
              clinicDescription: null,
              countryCode: 'PH',
              timeZone: 'Asia/Manila',
              schedules: effectiveLocation.practiceSchedules,
              services: [
                {
                  id: 'draft-service-1',
                  effectiveServiceId: 'service-effective-1',
                  sourceDoctorServiceTemplateId: null,
                  name: savedServiceName,
                  description: savedServiceDescription,
                  durationMinutes: 30,
                  status: 'ACTIVE',
                },
              ],
              bookingQuestions: [],
            },
          },
        ] as never;
      }

      if (path === '/practice-location/schedule-preflight') {
        return { valid: true } as never;
      }

      if (
        path === '/practice-location/location-active-1/configuration-draft' &&
        options?.method === 'PUT'
      ) {
        const body = options.body as {
          services: Array<{ name: string; description?: string }>;
        };
        savedServiceName = body.services[0].name;
        savedServiceDescription = body.services[0].description ?? '';
        draftSaved = true;
        return effectiveLocation as never;
      }

      throw new Error(`Unexpected API request: ${path}`);
    });

    const user = userEvent.setup();
    render(<ClinicTabPage />);

    expect(await screen.findByText('Effective Clinic')).toBeInTheDocument();

    await user.click(
      screen.getByRole('button', { name: 'More actions for Effective Clinic' }),
    );
    await user.click(screen.getByRole('menuitem', { name: /Edit Clinic/ }));
    await user.click(screen.getByRole('button', { name: 'Edit Clinic' }));

    await user.click(screen.getByRole('button', { name: 'Save and Continue' }));
    await user.click(screen.getByRole('button', { name: 'Save and Continue' }));

    const serviceName = screen.getByDisplayValue('General Consultation');
    const serviceDescription = screen.getByDisplayValue('Effective wording');
    await user.clear(serviceName);
    await user.type(serviceName, 'Draft Consultation');
    await user.clear(serviceDescription);
    await user.type(serviceDescription, 'Unpublished draft wording');

    await user.click(
      screen.getByRole('button', { name: 'Choose save action' }),
    );
    await user.click(screen.getByRole('menuitem', { name: /Save as Draft/ }));
    await user.click(screen.getByRole('button', { name: 'Save as Draft' }));

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Clinics' })).toBeInTheDocument();
    });

    expect(screen.getByText('Effective Clinic')).toBeInTheDocument();
    expect(screen.queryByText('Draft Consultation')).not.toBeInTheDocument();

    await user.click(
      screen.getByRole('button', { name: 'More actions for Effective Clinic' }),
    );
    await user.click(screen.getByRole('menuitem', { name: /Edit Clinic/ }));
    await user.click(screen.getByRole('button', { name: 'Edit Clinic' }));
    await user.click(screen.getByRole('button', { name: 'Save and Continue' }));
    await user.click(screen.getByRole('button', { name: 'Save and Continue' }));

    expect(screen.getByDisplayValue('Draft Consultation')).toBeInTheDocument();
    expect(
      screen.getByDisplayValue('Unpublished draft wording'),
    ).toBeInTheDocument();

    expect(savedServiceName).toBe('Draft Consultation');
    expect(savedServiceDescription).toBe('Unpublished draft wording');
  });
});
