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
      if (!value) throw new Error(`Missing test configuration: ${name}`);
      return value;
    }),
  };
  const otpGeneratorMock = { generate: jest.fn<string, []>() };
  const otpVerificationMock = {
    findFirst: jest.fn(),
    count: jest.fn(),
    aggregate: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
    create: jest.fn(),
  };
  const transactionMock = {
    $queryRaw: jest.fn(),
    otpVerification: otpVerificationMock,
  };
  const prismaServiceMock = {
    $transaction: jest.fn(
      (callback: (transaction: typeof transactionMock) => unknown) =>
        Promise.resolve(callback(transactionMock)),
    ),
  };

  const activeDraft = (overrides: Record<string, unknown> = {}) => ({
    id: 'draft-1',
    status: 'PENDING_OTP',
    mobileNumberHash: 'a'.repeat(64),
    expiresAt: new Date(Date.now() + 20 * 60 * 1000),
    consumedAt: null,
    cancelledAt: null,
    ...overrides,
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OtpService,
        { provide: OtpGenerator, useValue: otpGeneratorMock },
        { provide: ConfigService, useValue: configServiceMock },
        { provide: PrismaService, useValue: prismaServiceMock },
      ],
    }).compile();

    service = module.get<OtpService>(OtpService);
    jest.clearAllMocks();
    otpVerificationMock.findFirst.mockResolvedValue(null);
    otpVerificationMock.count.mockResolvedValue(0);
    otpVerificationMock.aggregate.mockResolvedValue({
      _sum: { attemptCount: null },
    });
    otpVerificationMock.updateMany.mockResolvedValue({ count: 0 });
    otpGeneratorMock.generate.mockReturnValue('123456');
  });

  it('produces challenge-bound HMAC values', () => {
    const firstHash = service.hashOtp('draft-1', 'BOOKING', '123456');
    const sameHash = service.hashOtp('draft-1', 'BOOKING', '123456');
    const differentDraft = service.hashOtp('draft-2', 'BOOKING', '123456');

    expect(firstHash).toBe(sameHash);
    expect(firstHash).not.toBe(differentDraft);
    expect(firstHash).toHaveLength(64);
    expect(
      service.verifyOtpHash('draft-1', 'BOOKING', '123456', firstHash),
    ).toBe(true);
    expect(
      service.verifyOtpHash('draft-1', 'BOOKING', '654321', firstHash),
    ).toBe(false);
  });

  it('issues one active booking challenge after locking the BookingDraft', async () => {
    transactionMock.$queryRaw.mockResolvedValueOnce([activeDraft()]);
    const createdAt = new Date();
    const expiresAt = new Date(createdAt.getTime() + 5 * 60 * 1000);
    otpVerificationMock.create.mockResolvedValue({
      id: 'otp-1',
      bookingDraftId: 'draft-1',
      purpose: 'BOOKING',
      expiresAt,
      attemptCount: 0,
      createdAt,
    });

    const result = await service.createBookingOtp('draft-1');

    expect(transactionMock.$queryRaw).toHaveBeenCalledTimes(1);
    expect(otpVerificationMock.updateMany).toHaveBeenCalledWith({
      where: {
        bookingDraftId: 'draft-1',
        purpose: 'BOOKING',
        activeContextKey: 'BOOKING:draft-1',
      },
      data: {
        invalidatedAt: expect.any(Date) as unknown,
        activeContextKey: null,
        otpHash: null,
      },
    });
    expect(otpVerificationMock.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        bookingDraftId: 'draft-1',
        mobileNumberHash: 'a'.repeat(64),
        mobileHashKeyVersion: 1,
        otpHash: expect.any(String) as unknown,
        otpHashKeyVersion: 1,
        purpose: 'BOOKING',
        activeContextKey: 'BOOKING:draft-1',
        expiresAt: expect.any(Date) as unknown,
      }) as unknown,
      select: expect.any(Object) as unknown,
    });
    expect(result.otp).toBe('123456');
  });

  it('enforces the sixty-second resend cooldown without changing draft lifetime', async () => {
    transactionMock.$queryRaw.mockResolvedValueOnce([activeDraft()]);
    otpVerificationMock.findFirst.mockResolvedValueOnce({
      createdAt: new Date(Date.now() - 30 * 1000),
    });

    await expect(service.createBookingOtp('draft-1')).rejects.toThrow(
      'OTP request is unavailable. Please try again later.',
    );
    expect(otpVerificationMock.create).not.toHaveBeenCalled();
  });

  it('enforces five booking challenges per context in thirty minutes', async () => {
    transactionMock.$queryRaw.mockResolvedValueOnce([activeDraft()]);
    otpVerificationMock.findFirst.mockResolvedValueOnce({
      createdAt: new Date(Date.now() - 61 * 1000),
    });
    otpVerificationMock.count.mockResolvedValueOnce(5);

    await expect(service.createBookingOtp('draft-1')).rejects.toThrow(
      'OTP request is unavailable. Please try again later.',
    );
    expect(otpVerificationMock.create).not.toHaveBeenCalled();
  });

  it('enforces mobile-wide issuance limits', async () => {
    transactionMock.$queryRaw.mockResolvedValueOnce([activeDraft()]);
    otpVerificationMock.findFirst.mockResolvedValueOnce(null);
    otpVerificationMock.count
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(10);

    await expect(service.createBookingOtp('draft-1')).rejects.toThrow(
      'OTP request is unavailable. Please try again later.',
    );
    expect(otpVerificationMock.create).not.toHaveBeenCalled();
  });

  it('rejects issuance after ten failed submissions in the context window', async () => {
    transactionMock.$queryRaw.mockResolvedValueOnce([activeDraft()]);
    otpVerificationMock.findFirst.mockResolvedValueOnce(null);
    otpVerificationMock.aggregate.mockResolvedValueOnce({
      _sum: { attemptCount: 10 },
    });

    await expect(service.createBookingOtp('draft-1')).rejects.toThrow(
      'OTP request is unavailable. Please try again later.',
    );
    expect(otpVerificationMock.create).not.toHaveBeenCalled();
  });

  it('does not replace a still-authoritative verified challenge', async () => {
    transactionMock.$queryRaw.mockResolvedValueOnce([activeDraft()]);
    otpVerificationMock.findFirst.mockResolvedValueOnce(null);
    otpVerificationMock.findFirst.mockResolvedValueOnce({
      id: 'otp-verified',
      verifiedAt: new Date(),
      invalidatedAt: null,
      consumedAt: null,
    });

    await expect(service.createBookingOtp('draft-1')).rejects.toThrow(
      'OTP request is unavailable. Please try again later.',
    );
    expect(otpVerificationMock.create).not.toHaveBeenCalled();
  });

  it('rejects issuance when the BookingDraft is unavailable', async () => {
    transactionMock.$queryRaw.mockResolvedValueOnce([]);

    await expect(service.createBookingOtp('missing-draft')).rejects.toThrow(
      'Booking draft is not available for OTP verification.',
    );
  });

  it('row-locks and verifies the current active booking OTP', async () => {
    const verifiedAt = new Date();
    transactionMock.$queryRaw
      .mockResolvedValueOnce([activeDraft()])
      .mockResolvedValueOnce([
        {
          id: 'otp-1',
          bookingDraftId: 'draft-1',
          otpHash: service.hashOtp('draft-1', 'BOOKING', '123456'),
          purpose: 'BOOKING',
          activeContextKey: 'BOOKING:draft-1',
          attemptCount: 0,
          expiresAt: new Date(Date.now() + 5 * 60 * 1000),
          verifiedAt: null,
          consumedAt: null,
          invalidatedAt: null,
        },
      ]);
    otpVerificationMock.update.mockResolvedValue({
      id: 'otp-1',
      bookingDraftId: 'draft-1',
      purpose: 'BOOKING',
      verifiedAt,
    });

    const result = await service.verifyBookingOtp('draft-1', '123456');

    expect(transactionMock.$queryRaw).toHaveBeenCalledTimes(2);
    expect(otpVerificationMock.update).toHaveBeenCalledWith({
      where: { id: 'otp-1' },
      data: { verifiedAt: expect.any(Date) as unknown },
      select: {
        id: true,
        bookingDraftId: true,
        purpose: true,
        verifiedAt: true,
      },
    });
    expect(result.otpVerification.id).toBe('otp-1');
  });

  it('increments incorrect attempts atomically without revealing counters', async () => {
    transactionMock.$queryRaw
      .mockResolvedValueOnce([activeDraft()])
      .mockResolvedValueOnce([
        {
          id: 'otp-1',
          bookingDraftId: 'draft-1',
          otpHash: service.hashOtp('draft-1', 'BOOKING', '123456'),
          purpose: 'BOOKING',
          activeContextKey: 'BOOKING:draft-1',
          attemptCount: 2,
          expiresAt: new Date(Date.now() + 5 * 60 * 1000),
          verifiedAt: null,
          consumedAt: null,
          invalidatedAt: null,
        },
      ]);
    otpVerificationMock.aggregate.mockResolvedValueOnce({
      _sum: { attemptCount: 2 },
    });
    otpVerificationMock.update.mockResolvedValue({ id: 'otp-1' });

    await expect(service.verifyBookingOtp('draft-1', '654321')).rejects.toThrow(
      'OTP verification failed.',
    );
    expect(otpVerificationMock.update).toHaveBeenCalledWith({
      where: { id: 'otp-1' },
      data: { attemptCount: { increment: 1 } },
    });
  });

  it('clears the active marker and secret on the fifth incorrect attempt', async () => {
    transactionMock.$queryRaw
      .mockResolvedValueOnce([activeDraft()])
      .mockResolvedValueOnce([
        {
          id: 'otp-1',
          bookingDraftId: 'draft-1',
          otpHash: service.hashOtp('draft-1', 'BOOKING', '123456'),
          purpose: 'BOOKING',
          activeContextKey: 'BOOKING:draft-1',
          attemptCount: 4,
          expiresAt: new Date(Date.now() + 5 * 60 * 1000),
          verifiedAt: null,
          consumedAt: null,
          invalidatedAt: null,
        },
      ]);
    otpVerificationMock.aggregate.mockResolvedValueOnce({
      _sum: { attemptCount: 4 },
    });
    otpVerificationMock.update.mockResolvedValue({ id: 'otp-1' });

    await expect(service.verifyBookingOtp('draft-1', '654321')).rejects.toThrow(
      'OTP verification failed.',
    );
    expect(otpVerificationMock.update).toHaveBeenCalledWith({
      where: { id: 'otp-1' },
      data: {
        attemptCount: { increment: 1 },
        invalidatedAt: expect.any(Date) as unknown,
        activeContextKey: null,
        otpHash: null,
      },
    });
  });

  it('clears an expired challenge without expiring the BookingDraft', async () => {
    transactionMock.$queryRaw
      .mockResolvedValueOnce([activeDraft()])
      .mockResolvedValueOnce([
        {
          id: 'otp-1',
          bookingDraftId: 'draft-1',
          otpHash: service.hashOtp('draft-1', 'BOOKING', '123456'),
          purpose: 'BOOKING',
          activeContextKey: 'BOOKING:draft-1',
          attemptCount: 0,
          expiresAt: new Date(Date.now() - 1000),
          verifiedAt: null,
          consumedAt: null,
          invalidatedAt: null,
        },
      ]);
    otpVerificationMock.update.mockResolvedValue({ id: 'otp-1' });

    await expect(service.verifyBookingOtp('draft-1', '123456')).rejects.toThrow(
      'OTP verification failed.',
    );
    expect(otpVerificationMock.update).toHaveBeenCalledWith({
      where: { id: 'otp-1' },
      data: { activeContextKey: null, otpHash: null },
    });
  });
});
