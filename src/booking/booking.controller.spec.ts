import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PublicServiceDateAvailabilityService } from '../schedule/public-service-date-availability.service';
import { BookingConfigurationService } from './booking-configuration.service';
import { BookingController } from './booking.controller';
import { BookingDraftEditService } from './booking-draft-edit.service';
import { BookingService } from './booking.service';
import { IndividualBookingConfirmationService } from './individual-booking-confirmation.service';

describe('BookingController', () => {
  let controller: BookingController;

  const bookingServiceMock = {
    createDraft: jest.fn(),
    verifyBookingOtp: jest.fn(),
  };
  const bookingDraftEditServiceMock = {
    replaceDraft: jest.fn(),
    requestBookingOtp: jest.fn(),
  };
  const bookingConfigurationServiceMock = {
    getEffectiveConfiguration: jest.fn(),
  };
  const publicServiceDateAvailabilityMock = {
    resolve: jest.fn(),
  };
  const individualBookingConfirmationServiceMock = {
    confirm: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [BookingController],
      providers: [
        {
          provide: BookingService,
          useValue: bookingServiceMock,
        },
        {
          provide: BookingDraftEditService,
          useValue: bookingDraftEditServiceMock,
        },
        {
          provide: BookingConfigurationService,
          useValue: bookingConfigurationServiceMock,
        },
        {
          provide: PublicServiceDateAvailabilityService,
          useValue: publicServiceDateAvailabilityMock,
        },
        {
          provide: IndividualBookingConfirmationService,
          useValue: individualBookingConfirmationServiceMock,
        },
      ],
    }).compile();

    controller = module.get<BookingController>(BookingController);

    jest.clearAllMocks();
    publicServiceDateAvailabilityMock.resolve.mockResolvedValue({
      availableForPublicBooking: true,
      reason: 'AVAILABLE',
    });
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should delegate public effective configuration reads', async () => {
    bookingConfigurationServiceMock.getEffectiveConfiguration.mockResolvedValue(
      {
        practiceLocation: { id: 'location-1' },
        services: [],
        bookingQuestions: [],
      },
    );

    await expect(controller.getConfiguration('location-1')).resolves.toEqual({
      practiceLocation: { id: 'location-1' },
      services: [],
      bookingQuestions: [],
    });
    expect(
      bookingConfigurationServiceMock.getEffectiveConfiguration,
    ).toHaveBeenCalledWith('location-1');
  });

  it('should delegate public Service Date availability reads', async () => {
    publicServiceDateAvailabilityMock.resolve.mockResolvedValue({
      practiceLocationId: 'location-1',
      serviceDate: '2026-08-17',
      availableForPublicBooking: true,
      reason: 'AVAILABLE',
    });

    await expect(
      controller.getAvailability('location-1', '2026-08-17'),
    ).resolves.toMatchObject({
      availableForPublicBooking: true,
      reason: 'AVAILABLE',
    });
    expect(publicServiceDateAvailabilityMock.resolve).toHaveBeenCalledWith(
      'location-1',
      '2026-08-17',
    );
  });

  it('checks public Service Date availability before creating a draft', async () => {
    const dto = {
      practiceLocationId: 'location-1',
      mode: 'INDIVIDUAL' as const,
      firstName: 'Maria',
      lastName: 'Reyes',
      existingPatientResponse: 'NO' as const,
      mobileNumber: '+639171234567',
      serviceDate: '2026-09-16',
      selectedServiceIds: ['service-1'],
    };
    bookingServiceMock.createDraft.mockResolvedValue({ bookingDraft: { id: 'draft-1' } });

    await expect(controller.createDraft(dto)).resolves.toMatchObject({
      bookingDraft: { id: 'draft-1' },
    });
    expect(publicServiceDateAvailabilityMock.resolve).toHaveBeenCalledWith(
      'location-1',
      '2026-09-16',
    );
    expect(bookingServiceMock.createDraft).toHaveBeenCalledWith(dto);
  });

  it('rejects direct draft creation when the Service Date is not publicly selectable', async () => {
    const dto = {
      practiceLocationId: 'location-1',
      mode: 'INDIVIDUAL' as const,
      firstName: 'Maria',
      lastName: 'Reyes',
      existingPatientResponse: 'NO' as const,
      mobileNumber: '+639171234567',
      serviceDate: '2026-09-17',
      selectedServiceIds: ['service-1'],
    };
    publicServiceDateAvailabilityMock.resolve.mockResolvedValue({
      availableForPublicBooking: false,
      reason: 'OUTSIDE_ADVANCE_BOOKING_WINDOW',
    });

    await expect(controller.createDraft(dto)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(bookingServiceMock.createDraft).not.toHaveBeenCalled();
  });

  it('should delegate controlled draft replacement', async () => {
    const dto = {
      practiceLocationId: 'location-1',
      mode: 'INDIVIDUAL' as const,
      firstName: 'Maria',
      lastName: 'Reyes',
      existingPatientResponse: 'NO' as const,
      mobileNumber: '+639171234567',
      serviceDate: '2026-08-17',
      selectedServiceIds: ['service-1'],
      draftControlToken: 'browser-secret',
    };
    bookingDraftEditServiceMock.replaceDraft.mockResolvedValue({
      bookingDraftId: 'draft-1',
      materialChanged: true,
    });

    await expect(
      controller.replaceDraft('draft-1', dto),
    ).resolves.toMatchObject({ materialChanged: true });
    expect(bookingDraftEditServiceMock.replaceDraft).toHaveBeenCalledWith(
      'draft-1',
      dto,
    );
  });

  it('should delegate controlled booking OTP requests', async () => {
    const dto = { draftControlToken: 'browser-secret' };
    bookingDraftEditServiceMock.requestBookingOtp.mockResolvedValue({
      bookingDraftId: 'draft-1',
      otpVerification: { id: 'otp-1' },
    });

    await expect(
      controller.requestBookingOtp('draft-1', dto),
    ).resolves.toMatchObject({ bookingDraftId: 'draft-1' });
    expect(bookingDraftEditServiceMock.requestBookingOtp).toHaveBeenCalledWith(
      'draft-1',
      dto,
    );
  });

  it('should delegate OTP verification to BookingService', async () => {
    const dto = {
      bookingDraftId: 'draft-1',
      otp: '123456',
    };

    bookingServiceMock.verifyBookingOtp.mockResolvedValue({
      message: 'OTP verified successfully.',
      otpVerification: {
        id: 'otp-1',
        bookingDraftId: 'draft-1',
        purpose: 'BOOKING_VERIFICATION',
        verifiedAt: new Date('2026-08-06T05:00:00.000Z'),
      },
    });

    const result = await controller.verifyOtp(dto);

    expect(bookingServiceMock.verifyBookingOtp).toHaveBeenCalledTimes(1);
    expect(bookingServiceMock.verifyBookingOtp).toHaveBeenCalledWith(dto);
    expect(result).toEqual({
      message: 'OTP verified successfully.',
      otpVerification: {
        id: 'otp-1',
        bookingDraftId: 'draft-1',
        purpose: 'BOOKING_VERIFICATION',
        verifiedAt: new Date('2026-08-06T05:00:00.000Z'),
      },
    });
  });

  it('should delegate individual confirmation with the Idempotency-Key header', async () => {
    individualBookingConfirmationServiceMock.confirm.mockResolvedValue({
      appointment: {
        id: 'appointment-1',
        queueNumber: 7,
      },
      bookingAccessToken: {
        token: 'one-time-raw-token',
        expiresAt: new Date('2026-08-27T00:00:00.000Z'),
      },
      replayed: false,
    });

    await expect(
      controller.confirmIndividualBooking('draft-1', 'idem-1'),
    ).resolves.toMatchObject({
      appointment: { id: 'appointment-1', queueNumber: 7 },
      replayed: false,
    });
    expect(
      individualBookingConfirmationServiceMock.confirm,
    ).toHaveBeenCalledWith({
      bookingDraftId: 'draft-1',
      idempotencyKey: 'idem-1',
    });
  });
});
