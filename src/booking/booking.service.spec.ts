import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { MobileNumberService } from '../security/mobile-number/mobile-number.service';
import { BookingReferenceGenerator } from './booking-reference.generator';
import { BookingService } from './booking.service';
import { Prisma } from '../../generated/prisma/client';
import { OtpService } from '../otp/otp.service';

describe('BookingService', () => {
  let service: BookingService;

  const prismaServiceMock = {
    practiceLocation: {
      findFirst: jest.fn(),
    },
    bookingDraft: {
      create: jest.fn(),
    },
  };
  const otpServiceMock = {
  createBookingOtp: jest.fn(),
  verifyBookingOtp: jest.fn(),
};

  const mobileNumberServiceMock = {
    protect: jest.fn(),
  };

  const bookingReferenceGeneratorMock = {
    generate: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BookingService,
        {
          provide: PrismaService,
          useValue: prismaServiceMock,
        },
        {
          provide: MobileNumberService,
          useValue: mobileNumberServiceMock,
        },
        {
          provide: BookingReferenceGenerator,
          useValue: bookingReferenceGeneratorMock,
        },
        {
          provide: OtpService,
          useValue: otpServiceMock,
        },
      ],
    }).compile();

    service = module.get<BookingService>(BookingService);

    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should retry when booking reference already exists', async () => {
  const dto = {
    practiceLocationId: 'practice-1',
    firstName: 'Maria',
    middleName: 'Santos',
    lastName: 'Reyes',
    suffix: 'Jr.',
    existingPatientResponse: 'UNSURE' as const,
    mobileNumber: '+639171234567',
    serviceDate: '2026-08-10',
  };

  prismaServiceMock.practiceLocation.findFirst.mockResolvedValue({
    id: 'practice-1',
    name: 'Clinic',
    doctorProfile: {
      accountSettings: {
        defaultConsultationMinutes: 30,
      },
    },
  });

  mobileNumberServiceMock.protect.mockReturnValue({
    encrypted: 'encrypted-mobile',
    hash: 'mobile-hash',
    lastFour: '4567',
  });

  bookingReferenceGeneratorMock.generate
    .mockReturnValueOnce('CQ-FIRST')
    .mockReturnValueOnce('CQ-SECOND');

  const uniqueError = new Prisma.PrismaClientKnownRequestError(
    'Unique constraint failed',
    {
      code: 'P2002',
      clientVersion: 'test',
    },
  );

  prismaServiceMock.bookingDraft.create
    .mockRejectedValueOnce(uniqueError)
    .mockResolvedValueOnce({
      id: 'draft-1',
      bookingReference: 'CQ-SECOND',
      status: 'PENDING_OTP',
      practiceLocationId: 'practice-1',
      existingPatientResponse: 'UNSURE' as const,
      serviceDate: new Date('2026-08-10'),
      estimatedServiceMinutes: 30,
      expiresAt: new Date(),
      createdAt: new Date(),
    });

  otpServiceMock.createBookingOtp.mockResolvedValue({
    otp: '123456',
    otpVerification: {
    id: 'otp-1',
    expiresAt: new Date(
      '2026-08-10T00:05:00.000Z',
    ),
    maxAttempts: 5,
  },
  });

  const result = await service.createDraft(dto);

  expect(
    bookingReferenceGeneratorMock.generate,
  ).toHaveBeenCalledTimes(2);

  expect(
    prismaServiceMock.bookingDraft.create,
  ).toHaveBeenCalledTimes(2);

  expect(
  otpServiceMock.createBookingOtp,
).toHaveBeenCalledTimes(1);

expect(
  otpServiceMock.createBookingOtp,
).toHaveBeenCalledWith('draft-1');

expect(result.bookingDraft.bookingReference).toBe(
  'CQ-SECOND',
);

expect(result).not.toHaveProperty('otp');

expect(result.otpVerification).toEqual({
  id: 'otp-1',
  expiresAt: new Date(
    '2026-08-10T00:05:00.000Z',
  ),
  maxAttempts: 5,
});
  });

  it('should delegate booking OTP verification to OtpService', async () => {
  otpServiceMock.verifyBookingOtp.mockResolvedValue({
    message: 'OTP verified successfully.',
    otpVerification: {
      id: 'otp-1',
      bookingDraftId: 'draft-1',
      purpose: 'BOOKING_VERIFICATION',
      verifiedAt: new Date(
        '2026-08-06T05:00:00.000Z',
      ),
    },
  });

  const result = await service.verifyBookingOtp({
    bookingDraftId: 'draft-1',
    otp: '123456',
  });

  expect(
    otpServiceMock.verifyBookingOtp,
  ).toHaveBeenCalledTimes(1);

  expect(
    otpServiceMock.verifyBookingOtp,
  ).toHaveBeenCalledWith(
    'draft-1',
    '123456',
  );

  expect(result).toEqual({
    message: 'OTP verified successfully.',
    otpVerification: {
      id: 'otp-1',
      bookingDraftId: 'draft-1',
      purpose: 'BOOKING_VERIFICATION',
      verifiedAt: new Date(
        '2026-08-06T05:00:00.000Z',
      ),
    },
  });
});
});