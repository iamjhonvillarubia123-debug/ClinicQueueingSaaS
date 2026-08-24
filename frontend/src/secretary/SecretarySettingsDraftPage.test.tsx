import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
    bookingQuestions: [{ id: 'question-1', questionText: 'First visit?', helpText: null, type: 'BOOLEAN', isRequired: false, displayOrder: 0, isActive: true, textMaximumLength: null, numberMinimum: null, numberMaximum: null, selectOptions: null }],
  },
  proposedClinicDetails: null, proposedPracticeSchedules: [], proposedServices: [], proposedBookingQuestions: [], proposedScheduleExceptions: [],
};

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function renderDraft() {
  render(<MemoryRouter initialEntries={['/app/secretary/settings-drafts/draft-1']}><Routes><Route path="/app/secretary/settings-drafts/:draftId" element={<SecretarySettingsDraftPage />} /></Routes></MemoryRouter>);
}

describe('SecretarySettingsDraftPage', () => {
  it('uses section navigation instead of stacking every granted configuration family', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response(editableDraft));
    renderDraft();

    expect(await screen.findByRole('heading', { name: 'North Clinic' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Clinic details' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Services' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Booking questions' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Clinic schedules' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Identity, address & contact' })).toBeInTheDocument();
    expect(screen.queryByDisplayValue('Consultation')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Services' }));
    expect(screen.getByDisplayValue('Consultation')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Booking questions' }));
    expect(screen.getByDisplayValue('First visit?')).toBeInTheDocument();
  });

  it('submits the draft without a Secretary withdrawal action', async () => {
    let current = { ...editableDraft, proposedClinicDetails: { id: 'proposal-1', proposedName: 'North Clinic', proposedAddressLine1: '1 Main Street', proposedAddressLine2: null, proposedCityMunicipality: 'Manila', proposedProvince: 'Metro Manila', proposedPostalCode: '1000', proposedContactNumber: '09170000000', proposedCountryCode: 'PH', proposedTimeZone: 'Asia/Manila' } };
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/submit')) {
        current = { ...current, status: 'SUBMITTED' };
        return response({ submitted: true, draftId: 'draft-1', status: 'SUBMITTED' });
      }
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
    expect(screen.queryByRole('button', { name: 'Services' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Booking questions' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Clinic schedules' })).not.toBeInTheDocument();
  });

  it('shows returned-for-rework as editable with the Doctor note and a clean exit', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({ ...editableDraft, status: 'RETURNED_FOR_REWORK', reviewComment: 'Please adjust Friday hours.' }));
    renderDraft();

    expect(await screen.findByText('Please adjust Friday hours.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Cancel' })).toHaveAttribute('href', '/app/secretary/clinics');
    expect(screen.getByRole('link', { name: /Back to clinics/i })).toHaveAttribute('href', '/app/secretary/clinics');
  });
});
