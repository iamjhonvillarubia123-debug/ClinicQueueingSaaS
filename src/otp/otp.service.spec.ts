import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';

import { OtpGenerator } from './otp.generator';
import { OtpService } from './otp.service';
import { PrismaService } from '../prisma/prisma.service';

describe('OtpService', () => {
  let service: OtpService;

  const otpHmacKeyBase64 = Buffer.alloc(32, 3).toString('base64');

  const configServiceMock = {
    getOrThrow: jest.fn((name: string) => {
      const values: Record<string, string> = {
        OTP_HMAC_KEY_V1: otpHmacKeyBase64,
        OTP_HMAC_ACTIVE_KEY_ID: 'v1',
      };

      const value = values[name];

      if (!value) {
        throw new Error(`Missing test configuration: ${name}`);
      }

      return value;
    }),
  };

  const otpGeneratorMock = {
    generate: jest.fn<string, []>(),
  };

  const bookingDraftMock = {
    findFirst: jest.fn(),
  };

  const otpVerificationMock = {
    findFirst: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
    create: jest.fn(),
  };

  type PrismaTransactionMock = {
    bookingDraft: typeof bookingDraftMock;
    otpVerification: typeof otpVerificationMock;
  };

  const transactionMock: PrismaTransactionMock = {
    bookingDraft: bookingDraftMock,
    otpVerification: otpVerificationMock,
  };

  const prismaServiceMock = {
    bookingDraft: bookingDraftMock,
    otpVerification: otpVerificationMock,
    $transaction: jest.fn(
      (callback: (transaction: PrismaTransactionMock) => unknown) =>
        Promise.resolve(callback(transactionMock)),
    ),
  };
  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OtpService,
        {
          provide: OtpGenerator,
          useValue: otpGeneratorMock,
        },
        {
          provide: ConfigService,
          useValue: configServiceMock,
        },
        {
          provide: PrismaService,
          useValue: prismaServiceMock,
        },
      ],
    }).compile();

    service = module.get<OtpService>(OtpService);

    jest.clearAllMocks();
  });

  it('should produce the same hash for the same OTP context', () => {
    const firstHash = service.hashOtp('draft-1', 'BOOKING', '123456');

    const secondHash = service.hashOtp('draft-1', 'BOOKING', '123456');

    expect(firstHash).toBe(secondHash);
    expect(firstHash).toHaveLength(64);
  });

  it('should produce different hashes for different booking drafts', () => {
    const firstHash = service.hashOtp('draft-1', 'BOOKING', '123456');

    const secondHash = service.hashOtp('draft-2', 'BOOKING', '123456');

    expect(firstHash).not.toBe(secondHash);
  });

  it('should produce different hashes for different OTP values', () => {
    const firstHash = service.hashOtp('draft-1', 'BOOKING', '123456');

    const secondHash = service.hashOtp('draft-1', 'BOOKING', '654321');

    expect(firstHash).not.toBe(secondHash);
    expect(firstHash).toHaveLength(64);
    expect(secondHash).toHaveLength(64);
  });
  it('should verify a valid OTP hash', () => {
    const storedHash = service.hashOtp('draft-1', 'BOOKING', '123456');

    const matches = service.verifyOtpHash(
      'draft-1',
      'BOOKING',
      '123456',
      storedHash,
    );

    expect(matches).toBe(true);
  });

  it('should reject an invalid OTP hash', () => {
    const storedHash = service.hashOtp('draft-1', 'BOOKING', '123456');

    const matches = service.verifyOtpHash(
      'draft-1',
      'BOOKING',
      '654321',
      storedHash,
    );

    expect(matches).toBe(false);
  });
  it('should reject a malformed stored OTP hash', () => {
    const matches = service.verifyOtpHash(
      'draft-1',
      'BOOKING',
      '123456',
      'not-a-valid-hex-hash',
    );

    expect(matches).toBe(false);
  });

  it('should invalidate previous OTPs and create a new booking OTP', async () => {
    const createdAt = new Date();
    const expiresAt = new Date(createdAt.getTime() + 5 * 60 * 1000);

    prismaServiceMock.bookingDraft.findFirst.mockResolvedValue({
      id: 'draft-1',
      mobileNumberHash: 'mobile-hash',
    });

    prismaServiceMock.otpVerification.updateMany.mockResolvedValue({
      count: 1,
    });

    otpGeneratorMock.generate.mockReturnValue('123456');

    prismaServiceMock.otpVerification.create.mockResolvedValue({
      id: 'otp-1',
      bookingDraftId: 'draft-1',
      purpose: 'BOOKING',
      expiresAt,
      attemptCount: 0,
      createdAt,
    });

    const result = await service.createBookingOtp('draft-1');

    expect(prismaServiceMock.bookingDraft.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'draft-1',
        status: 'PENDING_OTP',
        expiresAt: {
          gt: expect.any(Date) as unknown,
        },
        consumedAt: null,
        cancelledAt: null,
      },
      select: {
        id: true,
        mobileNumberHash: true,
      },
    });

    expect(prismaServiceMock.otpVerification.updateMany).toHaveBeenCalledWith({
      where: {
        bookingDraftId: 'draft-1',
        purpose: 'BOOKING',
        verifiedAt: null,
        consumedAt: null,
        invalidatedAt: null,
      },
      data: {
        invalidatedAt: expect.any(Date) as unknown,
      },
    });

    expect(otpGeneratorMock.generate).toHaveBeenCalledTimes(1);

    expect(prismaServiceMock.otpVerification.create).toHaveBeenCalledWith({
      data: {
        bookingDraftId: 'draft-1',
        mobileNumberHash: 'mobile-hash',
        otpHash: expect.any(String) as unknown,
        purpose: 'BOOKING',
        expiresAt: expect.any(Date) as unknown,
      },
      select: {
        id: true,
        bookingDraftId: true,
        purpose: true,
        expiresAt: true,
        attemptCount: true,
        createdAt: true,
      },
    });

    expect(result).toEqual({
      otp: '123456',
      otpVerification: {
        id: 'otp-1',
        bookingDraftId: 'draft-1',
        purpose: 'BOOKING',
        expiresAt,
        attemptCount: 0,
        createdAt,
      },
    });
  });

  it('should reject OTP creation when the booking draft is unavailable', async () => {
    prismaServiceMock.bookingDraft.findFirst.mockResolvedValue(null);

    await expect(service.createBookingOtp('missing-draft')).rejects.toThrow(
      'Booking draft is not available for OTP verification.',
    );

    expect(prismaServiceMock.otpVerification.updateMany).not.toHaveBeenCalled();

    expect(otpGeneratorMock.generate).not.toHaveBeenCalled();

    expect(prismaServiceMock.otpVerification.create).not.toHaveBeenCalled();
  });

  it('should verify a valid booking OTP', async () => {
    const now = new Date();

    prismaServiceMock.otpVerification.findFirst.mockResolvedValue({
      id: 'otp-1',
      bookingDraftId: 'draft-1',
      otpHash: service.hashOtp('draft-1', 'BOOKING', '123456'),
      purpose: 'BOOKING',
      attemptCount: 0,
    });

    prismaServiceMock.otpVerification.update.mockResolvedValue({
      id: 'otp-1',
      bookingDraftId: 'draft-1',
      purpose: 'BOOKING',
      verifiedAt: now,
    });

    const result = await service.verifyBookingOtp('draft-1', '123456');

    expect(prismaServiceMock.otpVerification.findFirst).toHaveBeenCalled();

    expect(prismaServiceMock.otpVerification.update).toHaveBeenCalledWith({
      where: {
        id: 'otp-1',
      },
      data: {
        verifiedAt: expect.any(Date) as unknown,
      },
      select: {
        id: true,
        bookingDraftId: true,
        purpose: true,
        verifiedAt: true,
      },
    });

    expect(result).toEqual({
      message: 'OTP verified successfully.',
      otpVerification: {
        id: 'otp-1',
        bookingDraftId: 'draft-1',
        purpose: 'BOOKING',
        verifiedAt: now,
      },
    });
  });

  it('should increment the attempt count for an incorrect OTP', async () => {
    prismaServiceMock.otpVerification.findFirst.mockResolvedValue({
      id: 'otp-1',
      bookingDraftId: 'draft-1',
      otpHash: service.hashOtp('draft-1', 'BOOKING', '123456'),
      purpose: 'BOOKING',
      attemptCount: 2,
    });

    prismaServiceMock.otpVerification.update.mockResolvedValue({
      id: 'otp-1',
    });

    await expect(service.verifyBookingOtp('draft-1', '654321')).rejects.toThrow(
      'OTP verification failed.',
    );

    expect(prismaServiceMock.otpVerification.update).toHaveBeenCalledWith({
      where: {
        id: 'otp-1',
      },
      data: {
        attemptCount: {
          increment: 1,
        },
        invalidatedAt: null,
      },
    });
  });

  it('should invalidate the OTP on the fifth incorrect attempt', async () => {
    prismaServiceMock.otpVerification.findFirst.mockResolvedValue({
      id: 'otp-1',
      bookingDraftId: 'draft-1',
      otpHash: service.hashOtp('draft-1', 'BOOKING', '123456'),
      purpose: 'BOOKING',
      attemptCount: 4,
    });

    prismaServiceMock.otpVerification.update.mockResolvedValue({
      id: 'otp-1',
    });

    await expect(service.verifyBookingOtp('draft-1', '654321')).rejects.toThrow(
      'OTP verification failed.',
    );

    expect(prismaServiceMock.otpVerification.update).toHaveBeenCalledWith({
      where: {
        id: 'otp-1',
      },
      data: {
        attemptCount: {
          increment: 1,
        },
        invalidatedAt: expect.any(Date) as unknown,
      },
    });
  });

  it('should reject verification when no active OTP is available', async () => {
    prismaServiceMock.otpVerification.findFirst.mockResolvedValue(null);

    await expect(service.verifyBookingOtp('draft-1', '123456')).rejects.toThrow(
      'OTP verification failed.',
    );

    expect(prismaServiceMock.otpVerification.update).not.toHaveBeenCalled();
  });
});
