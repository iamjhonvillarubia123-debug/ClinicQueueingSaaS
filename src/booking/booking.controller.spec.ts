import { Test, TestingModule } from '@nestjs/testing';
import { PublicServiceDateAvailabilityService } from '../schedule/public-service-date-availability.service';
import { BookingConfigurationService } from './booking-configuration.service';
import { BookingController } from './booking.controller';
import { BookingService } from './booking.service';

describe('BookingController', () => {
  let controller: BookingController;

  const bookingServiceMock = {
    createDraft: jest.fn(),
    verifyBookingOtp: jest.fn(),
  };
  const bookingConfigurationServiceMock = {
    getEffectiveConfiguration: jest.fn(),
  };
  const publicServiceDateAvailabilityMock = {
    resolve: jest.fn(),
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
          provide: BookingConfigurationService,
          useValue: bookingConfigurationServiceMock,
        },
        {
          provide: PublicServiceDateAvailabilityService,
          useValue: publicServiceDateAvailabilityMock,
        },
      ],
    }).compile();

    controller = module.get<BookingController>(BookingController);

    jest.clearAllMocks();
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
});
