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
  shortCode: null,
  addressLine1: 'Main Street',
  contactNumber: null,
  clinicEmail: null,
  clinicDescription: null,
  countryCode: 'PH',
  timeZone: 'Asia/Manila',
  services: [
    {
      id: 'service-1',
      sourceDoctorServiceTemplateId: null,
      name: 'General Consultation',
      description: 'Regular check-up',
      durationMinutes: 30,
      status: 'ACTIVE',
    },
  ],
  bookingQuestions: [
    {
      id: 'question-1',
      questionText: 'What is the reason for your visit?',
      type: 'TEXT',
      isRequired: true,
      displayOrder: 1,
      isActive: true,
    },
  ],
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

describe('ClinicTabPage configuration draft persistence', () => {
  beforeEach(() => {
    apiRequestMock.mockReset();
    apiRequestMock.mockImplementation(async (path, options) => {
      if (path === '/practice-location' && !options) return [location] as never;
      if (path === '/practice-location' && options?.method === 'POST')
        return location as never;
      if (path === '/practice-location/schedule-preflight')
        return { valid: true } as never;
      if (
        path === '/practice-location/location-1/configuration-draft' &&
        options?.method === 'PUT'
      )
        return location as never;
      throw new Error(`Unexpected API request: ${path}`);
    });
  });

  it('loads persisted hours and saves the whole configuration document', async () => {
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
        '/practice-location/location-1/configuration-draft',
        expect.objectContaining({
          method: 'PUT',
          body: expect.objectContaining({
            basicInfo: expect.objectContaining({
              name: 'Saved Clinic',
              addressLine1: 'Main Street',
              timeZone: 'Asia/Manila',
            }),
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
            services: expect.arrayContaining([
              expect.objectContaining({
                effectiveServiceId: 'service-1',
                name: 'General Consultation',
                description: 'Regular check-up',
                durationMinutes: 30,
                status: 'ACTIVE',
              }),
            ]),
            bookingQuestions: expect.arrayContaining([
              expect.objectContaining({
                effectiveBookingQuestionId: 'question-1',
                questionText: 'What is the reason for your visit?',
                displayOrder: 1,
                isActive: true,
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

    expect(
      screen.getByRole('button', { name: 'Activate Clinic' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Clinics' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Activate Clinic' }));
    expect(screen.getByRole('heading', { name: 'Clinics' })).toBeInTheDocument();
  });

  it('loads the last whole Doctor draft for editing while keeping the list on effective values', async () => {
    const activeLocation = {
      ...location,
      lifecycleStatus: 'ACTIVE',
      doctorScheduleDraft: {
        name: 'Draft Clinic Name',
        shortCode: 'DRAFT',
        addressLine1: 'Draft Street',
        contactNumber: '09170000000',
        clinicEmail: 'draft@example.com',
        clinicDescription: 'Unpublished clinic description',
        countryCode: 'PH',
        timeZone: 'Asia/Manila',
        schedules: [
          {
            ...location.practiceSchedules[0],
            opensAtLocal: '1970-01-01T10:45:00.000Z',
            closesAtLocal: '1970-01-01T15:15:00.000Z',
            maximumOnlineBookingUntilLocal: '1970-01-01T13:15:00.000Z',
            maximumOperatingUntilLocal: '1970-01-01T16:00:00.000Z',
          },
        ],
        services: [
          {
            id: 'draft-service-1',
            effectiveServiceId: 'service-1',
            sourceDoctorServiceTemplateId: null,
            name: 'Draft Consultation',
            description: 'Unpublished service wording',
            durationMinutes: 45,
            status: 'ACTIVE',
          },
        ],
        bookingQuestions: [
          {
            id: 'draft-question-1',
            effectiveBookingQuestionId: 'question-1',
            sourceDoctorBookingQuestionTemplateId: null,
            questionText: 'Draft booking question?',
            type: 'TEXT',
            isRequired: false,
            displayOrder: 1,
            isActive: true,
          },
        ],
      },
    };

    apiRequestMock.mockImplementation(async (path, options) => {
      if (path === '/practice-location' && !options)
        return [activeLocation] as never;
      if (path === '/practice-location/schedule-preflight')
        return { valid: true } as never;
      if (
        path === '/practice-location/location-1/configuration-draft' &&
        options?.method === 'PUT'
      )
        return activeLocation as never;
      throw new Error(`Unexpected API request: ${path}`);
    });

    const user = userEvent.setup();
    render(<ClinicTabPage />);

    expect(await screen.findByText('Saved Clinic')).toBeInTheDocument();
    expect(screen.queryByText('Draft Clinic Name')).not.toBeInTheDocument();

    await user.click(
      screen.getByRole('button', {
        name: 'More actions for Saved Clinic',
      }),
    );
    await user.click(screen.getByRole('menuitem', { name: /Edit Clinic/ }));
    await user.click(screen.getByRole('button', { name: 'Edit Clinic' }));

    expect(screen.getByPlaceholderText('Enter clinic name')).toHaveValue(
      'Draft Clinic Name',
    );
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

    await user.click(screen.getByRole('button', { name: 'Save and Continue' }));
    expect(screen.getByDisplayValue('Draft Consultation')).toBeInTheDocument();
    expect(
      screen.getByDisplayValue('Unpublished service wording'),
    ).toBeInTheDocument();
  });
});
