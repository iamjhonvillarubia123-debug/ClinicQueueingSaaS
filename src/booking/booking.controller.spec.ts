import { Test, TestingModule } from '@nestjs/testing';
import { BookingController } from './booking.controller';
import { BookingService } from './booking.service';

describe('BookingController', () => {
  let controller: BookingController;

  const bookingServiceMock = {
    createDraft: jest.fn(),
    verifyBookingOtp: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [BookingController],
      providers: [
        {
          provide: BookingService,
          useValue: bookingServiceMock,
        },
      ],
    }).compile();

    controller = module.get<BookingController>(BookingController);

    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
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
