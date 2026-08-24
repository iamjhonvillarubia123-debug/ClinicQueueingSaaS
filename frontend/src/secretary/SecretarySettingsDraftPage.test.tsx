import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { SecretarySettingsDraftPage } from './SecretarySettingsDraftPage';

function response(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

const editableDraft = {
  id: 'draft-1',
  status: 'DRAFT',
  submittedAt: null,
  reviewedAt: null,
  reviewComment: null,
  practiceLocation: {
    id: 'location-1',
    name: 'North Clinic',
    lifecycleStatus: 'ACTIVE',
    timeZone: 'Asia/Manila',
    practiceSchedules: [{ weekday: 'MONDAY', isOpen: true, opensAtLocal: '1970-01-01T09:00:00.000Z', closesAtLocal: '1970-01-01T17:00:00.000Z', maximumOnlineBookingUntilLocal: null, maximumOperatingUntilLocal: null }],
    services: [{ id: 'service-1', name: 'Consultation', durationMinutes: 15, status: 'ACTIVE' }],
    bookingQuestions: [{ id: 'question-1', questionText: 'First visit?', helpText: null, type: 'BOOLEAN', isRequired: false, displayOrder: 0, isActive: true, textMaximumLength: null, numberMinimum: null, numberMaximum: null, selectOptions: null }],
  },
  proposedPracticeSchedules: [],
  proposedServices: [],
  proposedBookingQuestions: [],
  proposedScheduleExceptions: [],
};

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('SecretarySettingsDraftPage', () => {
  it('loads effective settings and submits the draft without a Secretary withdrawal action', async () => {
    let current = editableDraft;
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes('/submit')) {
        current = { ...editableDraft, status: 'SUBMITTED' };
        return response({ submitted: true, draftId: 'draft-1', status: 'SUBMITTED' });
      }
      return response(current);
    });

    render(<MemoryRouter initialEntries={['/app/secretary/settings-drafts/draft-1']}><Routes><Route path="/app/secretary/settings-drafts/:draftId" element={<SecretarySettingsDraftPage />} /></Routes></MemoryRouter>);

    expect(await screen.findByRole('heading', { name: 'North Clinic' })).toBeInTheDocument();
    expect(screen.getByDisplayValue('Consultation')).toBeInTheDocument();
    expect(screen.getByDisplayValue('First visit?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Submit draft to Doctor' }));

    await waitFor(() => expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/secretary-settings-drafts/draft-1/submit'))).toBe(true));
    expect(await screen.findByText(/cannot edit or withdraw/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /withdraw/i })).not.toBeInTheDocument();
  });

  it('shows a returned-for-rework draft as editable and preserves the Doctor note', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({ ...editableDraft, status: 'RETURNED_FOR_REWORK', reviewComment: 'Please adjust Friday hours.' }));
    render(<MemoryRouter initialEntries={['/app/secretary/settings-drafts/draft-1']}><Routes><Route path="/app/secretary/settings-drafts/:draftId" element={<SecretarySettingsDraftPage />} /></Routes></MemoryRouter>);

    expect(await screen.findByText('Please adjust Friday hours.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Submit draft to Doctor' })).toBeInTheDocument();
  });
});
