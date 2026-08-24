import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { SecretarySettingsDraftPage } from './SecretarySettingsDraftPage';

function response(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

const editableDraft = {
  id: 'draft-1', status: 'DRAFT', submittedAt: null, reviewedAt: null, reviewComment: null,
  practiceLocation: {
    id: 'location-1', name: 'North Clinic', addressLine1: '1 Main Street', addressLine2: null,
    cityMunicipality: 'Manila', province: 'Metro Manila', postalCode: '1000', contactNumber: '09170000000', countryCode: 'PH', lifecycleStatus: 'ACTIVE', timeZone: 'Asia/Manila',
    currentRegularPracticeStaff: { canManageClinicDetails: true, canManageServices: true, canManageBookingQuestions: true, canManageSchedules: true },
    practiceSchedules: [{ weekday: 'MONDAY', isOpen: true, opensAtLocal: '1970-01-01T09:00:00.000Z', closesAtLocal: '1970-01-01T17:00:00.000Z', maximumOnlineBookingUntilLocal: null, maximumOperatingUntilLocal: null }],
    services: [{ id: 'service-1', name: 'Consultation', durationMinutes: 15, status: 'ACTIVE' }],
    bookingQuestions: [
      { id: 'question-1', questionText: 'First visit?', helpText: null, type: 'BOOLEAN', isRequired: false, displayOrder: 0, isActive: true, textMaximumLength: null, numberMinimum: null, numberMaximum: null, selectOptions: null },
      { id: 'question-2', questionText: 'Reason for visit?', helpText: null, type: 'TEXT', isRequired: true, displayOrder: 1, isActive: true, textMaximumLength: 500, numberMinimum: null, numberMaximum: null, selectOptions: null },
    ],
  },
  proposedClinicDetails: null, proposedPracticeSchedules: [],
  proposedServices: [{ id: 'service-proposal-1', practiceLocationServiceId: null, proposedName: 'Vaccination', proposedDurationMinutes: 20, proposedStatus: 'ACTIVE' }],
  proposedBookingQuestions: [{ id: 'question-proposal-1', bookingQuestionId: null, proposedQuestionText: 'Any allergies?', proposedHelpText: null, proposedType: 'TEXT', proposedIsRequired: false, proposedDisplayOrder: 2, proposedIsActive: true, proposedTextMaximumLength: 500, proposedNumberMinimum: null, proposedNumberMaximum: null, proposedSelectOptions: null }],
  proposedScheduleExceptions: [],
};

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function renderDraft() {
  render(<MemoryRouter initialEntries={['/app/secretary/settings-drafts/draft-1']}><Routes><Route path="/app/secretary/settings-drafts/:draftId" element={<SecretarySettingsDraftPage />} /></Routes></MemoryRouter>);
}

describe('SecretarySettingsDraftPage', () => {
  it('renders the approved compact services and questions proposal UI', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response(editableDraft));
    renderDraft();
    expect(await screen.findByRole('heading', { name: 'North Clinic' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Services & questions' }));
    expect(screen.getByRole('heading', { name: 'Clinic services' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Patient booking questions' })).toBeInTheDocument();
    expect(screen.getByText('Consultation')).toBeInTheDocument();
    expect(screen.getByText('Vaccination')).toBeInTheDocument();
    expect(screen.getByText('First visit?')).toBeInTheDocument();
    expect(screen.getByText('Any allergies?')).toBeInTheDocument();
    expect(screen.getAllByText('Active').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Draft').length).toBeGreaterThan(0);
    expect(screen.queryByLabelText('Display order')).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Required/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Active for new bookings/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save service' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save question' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add service proposal' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add question proposal' })).toBeInTheDocument();
  });

  it('uses the trash action to propose service removal instead of deleting history', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      if (String(input).includes('/services/effective/service-1')) return response({ saved: true });
      return response(editableDraft);
    });
    renderDraft();
    fireEvent.click(await screen.findByRole('button', { name: 'Services & questions' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove Consultation' }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/services/effective/service-1'))).toBe(true));
    const call = fetchMock.mock.calls.find(([input]) => String(input).includes('/services/effective/service-1'));
    expect(String(call?.[1]?.body)).toContain('"status":"INACTIVE"');
  });

  it('persists booking-question drag order through displayOrder without exposing the field', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response(editableDraft));
    renderDraft();
    fireEvent.click(await screen.findByRole('button', { name: 'Services & questions' }));
    const questionList = screen.getByLabelText('Patient booking questions');
    const firstRow = within(questionList).getByText('First visit?').closest('.proposal-sort-row');
    const secondRow = within(questionList).getByText('Reason for visit?').closest('.proposal-sort-row');
    expect(firstRow).not.toBeNull(); expect(secondRow).not.toBeNull();
    fireEvent.dragStart(firstRow!); fireEvent.dragOver(secondRow!); fireEvent.drop(secondRow!);
    await waitFor(() => expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/booking-questions/'))).toBe(true));
    const updateBodies = fetchMock.mock.calls.filter(([input]) => String(input).includes('/booking-questions/')).map(([, init]) => String(init?.body));
    expect(updateBodies.some((body) => body.includes('"displayOrder":0'))).toBe(true);
    expect(updateBodies.some((body) => body.includes('"displayOrder":1'))).toBe(true);
  });

  it('submits the draft without a Secretary withdrawal action', async () => {
    let current = { ...editableDraft, proposedClinicDetails: { id: 'proposal-1', proposedName: 'North Clinic', proposedAddressLine1: '1 Main Street', proposedAddressLine2: null, proposedCityMunicipality: 'Manila', proposedProvince: 'Metro Manila', proposedPostalCode: '1000', proposedContactNumber: '09170000000', proposedCountryCode: 'PH', proposedTimeZone: 'Asia/Manila' } };
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/submit')) { current = { ...current, status: 'SUBMITTED' }; return response({ submitted: true, draftId: 'draft-1', status: 'SUBMITTED' }); }
      return response(current);
    });
    renderDraft();
    expect(await screen.findByRole('button', { name: 'Submit to Doctor' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Submit to Doctor' }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/secretary-settings-drafts/draft-1/submit'))).toBe(true));
    expect(await screen.findByText(/cannot edit or withdraw/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /withdraw/i })).not.toBeInTheDocument();
  });

  it('saves clinic details as a proposal', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      if (String(input).includes('/clinic-details')) return response({ saved: true, proposalId: 'clinic-proposal-1' });
      return response(editableDraft);
    });
    renderDraft();
    expect(await screen.findByRole('heading', { name: 'Identity, address & contact' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Address line 1'), { target: { value: '2 New Street' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save clinic details' }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/secretary-settings-drafts/draft-1/clinic-details'))).toBe(true));
    const call = fetchMock.mock.calls.find(([input]) => String(input).includes('/clinic-details'));
    expect(String(call?.[1]?.body)).toContain('2 New Street');
  });

  it('hides ungranted configuration sections from a custom Secretary', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({ ...editableDraft, practiceLocation: { ...editableDraft.practiceLocation, currentRegularPracticeStaff: { canManageClinicDetails: true, canManageServices: false, canManageBookingQuestions: false, canManageSchedules: false } } }));
    renderDraft();
    expect(await screen.findByRole('heading', { name: 'Identity, address & contact' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Services & questions' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Clinic schedules' })).not.toBeInTheDocument();
  });

  it('shows only the granted panel inside the combined content section', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({ ...editableDraft, practiceLocation: { ...editableDraft.practiceLocation, currentRegularPracticeStaff: { canManageClinicDetails: false, canManageServices: true, canManageBookingQuestions: false, canManageSchedules: false } } }));
    renderDraft();
    fireEvent.click(await screen.findByRole('button', { name: 'Services & questions' }));
    expect(screen.getByRole('heading', { name: 'Clinic services' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Patient booking questions' })).not.toBeInTheDocument();
  });

  it('shows returned-for-rework as editable with the Doctor note and a clean exit', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({ ...editableDraft, status: 'RETURNED_FOR_REWORK', reviewComment: 'Please adjust Friday hours.' }));
    renderDraft();
    expect(await screen.findByText('Please adjust Friday hours.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Cancel' })).toHaveAttribute('href', '/app/secretary/clinics');
    expect(screen.getByRole('link', { name: /Back to clinics/i })).toHaveAttribute('href', '/app/secretary/clinics');
  });
});
