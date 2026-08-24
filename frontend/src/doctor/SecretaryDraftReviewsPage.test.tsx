import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { SecretaryDraftReviewPage, SecretaryDraftReviewsPage } from './SecretaryDraftReviewsPage';

function response(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

const submittedDraft = {
  id: 'draft-1',
  status: 'SUBMITTED',
  submittedAt: '2026-08-24T04:00:00.000Z',
  reviewedAt: null,
  reviewComment: null,
  authorPracticeStaff: { user: { firstName: 'Bea', lastName: 'Cruz' } },
  practiceLocation: {
    id: 'location-1',
    name: 'North Clinic',
    addressLine1: '1 Main Street',
    addressLine2: null,
    cityMunicipality: 'Manila',
    province: 'Metro Manila',
    postalCode: '1000',
    contactNumber: '09170000000',
    countryCode: 'PH',
    lifecycleStatus: 'ACTIVE',
    timeZone: 'Asia/Manila',
    practiceSchedules: [{ weekday: 'MONDAY', isOpen: true, opensAtLocal: '1970-01-01T09:00:00.000Z', closesAtLocal: '1970-01-01T17:00:00.000Z', maximumOnlineBookingUntilLocal: null, maximumOperatingUntilLocal: null }],
    scheduleExceptions: [],
    services: [{ id: 'service-1', name: 'Consultation', durationMinutes: 15, status: 'ACTIVE' }],
    bookingQuestions: [{ id: 'question-1', questionText: 'First visit?', type: 'BOOLEAN', isRequired: false, displayOrder: 0, isActive: true }],
  },
  proposedClinicDetails: {
    id: 'clinic-proposal-1',
    proposedName: 'North Clinic Updated',
    proposedAddressLine1: '2 New Street',
    proposedAddressLine2: null,
    proposedCityMunicipality: 'Manila',
    proposedProvince: 'Metro Manila',
    proposedPostalCode: '1000',
    proposedContactNumber: '09171111111',
    proposedCountryCode: 'PH',
    proposedTimeZone: 'Asia/Manila',
  },
  proposedPracticeSchedules: [{ id: 'schedule-proposal-1', weekday: 'MONDAY', proposedIsOpen: true, proposedOpensAtLocal: '1970-01-01T10:00:00.000Z', proposedClosesAtLocal: '1970-01-01T17:00:00.000Z', proposedMaximumOnlineBookingUntilLocal: null, proposedMaximumOperatingUntilLocal: null }],
  proposedScheduleExceptions: [],
  proposedServices: [{ id: 'service-proposal-1', practiceLocationServiceId: 'service-1', proposedName: 'Consultation', proposedDurationMinutes: 20, proposedStatus: 'ACTIVE' }],
  proposedBookingQuestions: [],
};

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('Doctor Secretary settings draft review', () => {
  it('lists submitted drafts and exposes a clear review action', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response([submittedDraft]));
    render(<MemoryRouter><SecretaryDraftReviewsPage /></MemoryRouter>);

    expect(await screen.findByRole('heading', { name: 'North Clinic' })).toBeInTheDocument();
    expect(screen.getByText(/Submitted by Bea Cruz/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Review changes' })).toHaveAttribute('href', '/app/secretary-draft-reviews/draft-1');
  });

  it('compares current and proposed clinic details and sends approval with an idempotency key', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/approve')) return response({ approved: true, draftId: 'draft-1', status: 'APPROVED' });
      return response(submittedDraft);
    });
    vi.stubGlobal('crypto', { randomUUID: () => '11111111-1111-4111-8111-111111111111' });

    render(
      <MemoryRouter initialEntries={['/app/secretary-draft-reviews/draft-1']}>
        <Routes>
          <Route path="/app/secretary-draft-reviews/:draftId" element={<SecretaryDraftReviewPage />} />
          <Route path="/app/secretary-draft-reviews" element={<div>Review inbox</div>} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: 'North Clinic' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Identity, address & contact proposal' })).toBeInTheDocument();
    expect(screen.getByText(/2 New Street/)).toBeInTheDocument();
    expect(screen.getByText(/North Clinic Updated/)).toBeInTheDocument();
    expect(screen.getByText(/09:00–17:00/)).toBeInTheDocument();
    expect(screen.getByText(/10:00–17:00/)).toBeInTheDocument();
    expect(screen.getByText(/Consultation · 15 min/)).toBeInTheDocument();
    expect(screen.getByText(/Consultation · 20 min/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Approve and apply' }));
    await screen.findByText('Review inbox');

    const approvalCall = fetchMock.mock.calls.find(([input]) => String(input).includes('/approve'));
    expect(approvalCall).toBeTruthy();
    const init = approvalCall?.[1] as RequestInit;
    expect(new Headers(init.headers).get('Idempotency-Key')).toBe('11111111-1111-4111-8111-111111111111');
  });

  it('allows return for rework without inventing a mandatory comment rule', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/return-for-rework')) return response({ reviewed: true, draftId: 'draft-1', status: 'RETURNED_FOR_REWORK' });
      return response(submittedDraft);
    });
    vi.stubGlobal('crypto', { randomUUID: () => '22222222-2222-4222-8222-222222222222' });

    render(
      <MemoryRouter initialEntries={['/app/secretary-draft-reviews/draft-1']}>
        <Routes>
          <Route path="/app/secretary-draft-reviews/:draftId" element={<SecretaryDraftReviewPage />} />
          <Route path="/app/secretary-draft-reviews" element={<div>Review inbox</div>} />
        </Routes>
      </MemoryRouter>,
    );

    await screen.findByRole('heading', { name: 'North Clinic' });
    fireEvent.click(screen.getByRole('button', { name: 'Return for rework' }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/return-for-rework'))).toBe(true));
    expect(await screen.findByText('Review inbox')).toBeInTheDocument();
  });
});
