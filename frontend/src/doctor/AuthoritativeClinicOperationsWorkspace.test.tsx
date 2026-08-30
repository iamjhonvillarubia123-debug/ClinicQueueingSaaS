import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthoritativeClinicOperationsWorkspace } from './AuthoritativeClinicOperationsWorkspace';
import type {
  ClinicOperationsOverview,
  ClinicOperationsQueue,
} from './ClinicOperationsWorkspace';

const clinic = {
  id: 'clinic-1',
  name: 'North Clinic',
  address: 'Davao City',
  countryCode: 'PH',
  timeZone: 'Asia/Manila',
  lifecycleStatus: 'ACTIVE',
  doctorName: 'Dr. Juan Dela Cruz',
};

const overview: ClinicOperationsOverview = {
  clinic,
  serviceDate: '2026-08-25',
  schedule: {
    isOpen: false,
    opensAt: null,
    closesAt: null,
  },
  clinicDay: null,
  queue: {
    counts: {},
    waitingCount: 0,
    nowServing: null,
    next: null,
    waitingPreview: [],
  },
  appointments: {
    total: 0,
    counts: {},
  },
  timeline: [],
};

const emptyQueue: ClinicOperationsQueue = {
  clinic,
  serviceDate: '2026-08-25',
  schedule: overview.schedule,
  clinicDay: null,
  counts: {},
  patients: [],
  timeline: [],
};

afterEach(cleanup);

describe('AuthoritativeClinicOperationsWorkspace', () => {
  it('keeps overview timeline, appointment summary, and staff empty when authoritative data is empty', async () => {
    const user = userEvent.setup();

    render(
      <AuthoritativeClinicOperationsWorkspace
        overview={overview}
        overviewLoading={false}
        overviewError=""
        queue={emptyQueue}
        queueLoading={false}
        queueError=""
        appointments={emptyQueue}
        appointmentsLoading={false}
        appointmentsError=""
        serviceDate="2026-08-25"
        onServiceDateChange={vi.fn()}
        onBack={vi.fn()}
        onEvent={vi.fn()}
        bookingConfiguration={null}
        loadAppointmentDetails={vi.fn()}
      />,
    );

    const timeline = screen.getByRole('heading', {
      name: 'Clinic Day Timeline',
    }).closest('article');
    expect(timeline).not.toBeNull();
    expect(
      within(timeline as HTMLElement).getByText(
        'No queue events have been recorded for this service date.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText('Maria Santos')).not.toBeInTheDocument();
    expect(screen.queryByText('Jane Reyes')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Appointments' }));

    expect(screen.getByText('Total Appointments').parentElement).toHaveTextContent(
      '0',
    );
    const appointmentSummary = screen
      .getByRole('heading', { name: 'Appointment Summary' })
      .closest('article');
    expect(appointmentSummary).not.toBeNull();
    const summary = within(appointmentSummary as HTMLElement);
    expect(summary.getByText('Waiting').parentElement).toHaveTextContent('0');
    expect(summary.getByText('Now Serving').parentElement).toHaveTextContent('0');
    expect(summary.getByText('Out for Procedure').parentElement).toHaveTextContent('0');
    expect(summary.getByText('Temporarily Absent').parentElement).toHaveTextContent('0');
    expect(summary.getByText('Completed').parentElement).toHaveTextContent('0');
    expect(summary.getByText('Cancelled').parentElement).toHaveTextContent('0');
    expect(screen.queryByText('12')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Staff' }));

    expect(
      screen.getByText('Staff integration is not connected yet.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Maria Santos')).not.toBeInTheDocument();
    expect(screen.queryByText('Jane Reyes')).not.toBeInTheDocument();
  });
});
