import { PublicBookingEntryService } from './public-booking-entry.service';

describe('PublicBookingEntryService', () => {
  const prisma = {
    practiceLocation: { findUnique: jest.fn() },
  };
  const publicRouting = { getPracticeLocationPublicRoute: jest.fn() };
  const configuration = { getEffectiveConfiguration: jest.fn() };
  const availability = { resolve: jest.fn() };
  const bookingService = { createDraft: jest.fn() };
  const bookingDraftEditService = { replaceDraft: jest.fn() };

  const service = new PublicBookingEntryService(
    prisma as never,
    publicRouting as never,
    configuration as never,
    availability as never,
    bookingService as never,
    bookingDraftEditService as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    publicRouting.getPracticeLocationPublicRoute.mockResolvedValue({
      publicIdentifier: 'public-clinic',
      bookingEntryAllowed: true,
    });
    prisma.practiceLocation.findUnique.mockResolvedValue({
      id: 'internal-location-id',
      publicIdentifier: 'public-clinic',
    });
  });

  it('returns booking configuration without exposing the internal PracticeLocation id', async () => {
    configuration.getEffectiveConfiguration.mockResolvedValue({
      practiceLocation: {
        id: 'internal-location-id',
        name: 'North Clinic',
        timeZone: 'Asia/Manila',
      },
      bookingWindow: { maximumAdvanceBookingDays: 30, upperBoundaryInclusive: true },
      services: [{ id: 'service-id', name: 'Consultation', durationMinutes: 30 }],
      bookingQuestions: [],
      serviceSelection: { maximumSelections: 3 },
    });

    const result = await service.getConfiguration('public-clinic');

    expect(configuration.getEffectiveConfiguration).toHaveBeenCalledWith('internal-location-id');
    expect(result.practiceLocation).toEqual({
      publicIdentifier: 'public-clinic',
      name: 'North Clinic',
      timeZone: 'Asia/Manila',
    });
    expect(result.practiceLocation).not.toHaveProperty('id');
  });

  it('strips the internal PracticeLocation id from public availability', async () => {
    availability.resolve.mockResolvedValue({
      practiceLocationId: 'internal-location-id',
      serviceDate: '2026-08-24',
      availableForPublicBooking: true,
      reason: 'AVAILABLE',
    });

    const result = await service.getAvailability('public-clinic', '2026-08-24');

    expect(availability.resolve).toHaveBeenCalledWith('internal-location-id', '2026-08-24');
    expect(result).not.toHaveProperty('practiceLocationId');
    expect(result.availableForPublicBooking).toBe(true);
  });

  it('injects the internal location id for draft creation but removes it from the browser response', async () => {
    availability.resolve.mockResolvedValue({ availableForPublicBooking: true });
    bookingService.createDraft.mockResolvedValue({
      bookingDraft: {
        id: 'draft-id',
        bookingReference: 'BR-1',
        practiceLocationId: 'internal-location-id',
      },
      draftControlToken: 'browser-control-token',
      otpVerification: { id: 'otp-id' },
    });

    const dto = {
      mode: 'INDIVIDUAL' as const,
      firstName: 'Ana',
      lastName: 'Santos',
      existingPatientResponse: 'NO' as const,
      mobileNumber: '+639171234567',
      serviceDate: '2026-08-24',
      privacyNoticeVersion: 'v1.0-2026-08',
      privacyNoticeAcknowledged: true,
      scheduledReminderOptIn: false,
      selectedServiceIds: ['service-id'],
      answers: [],
    };

    const result = await service.createDraft('public-clinic', dto);

    expect(bookingService.createDraft).toHaveBeenCalledWith({
      ...dto,
      practiceLocationId: 'internal-location-id',
    });
    expect(result.bookingDraft).not.toHaveProperty('practiceLocationId');
    expect(result.draftControlToken).toBe('browser-control-token');
  });
});
