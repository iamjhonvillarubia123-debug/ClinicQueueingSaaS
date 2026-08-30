import {
  BookingRecoveryAttemptStatus,
  CommandType,
  OtpPurpose,
} from '../../generated/prisma/client';
import { AppointmentRecoveryService } from './appointment-recovery.service';

describe('AppointmentRecoveryService', () => {
  const protectedMobile = {
    encrypted: 'encrypted-mobile',
    hash: 'mobile-hash',
    lastFour: '4567',
  };

  function buildService(
    transaction: Record<string, unknown>,
    locationId = 'location-1',
  ) {
    const prisma = {
      practiceLocation: {
        findUnique: jest.fn().mockResolvedValue({ id: locationId }),
      },
      $transaction: jest.fn(
        (callback: (tx: Record<string, unknown>) => unknown) =>
          Promise.resolve(callback(transaction)),
      ),
    };
    const mobileNumber = {
      protect: jest.fn().mockReturnValue(protectedMobile),
    };
    const otpGenerator = { generate: jest.fn().mockReturnValue('123456') };
    const otpService = {
      hashOtp: jest.fn().mockReturnValue('otp-hash'),
      verifyOtpHash: jest.fn().mockReturnValue(true),
    };
    const idempotency = {
      normalizeKey: jest.fn((value: string | undefined) => value ?? ''),
      deriveIdentity: jest.fn().mockReturnValue('command-identity'),
      fingerprint: jest.fn().mockReturnValue('fingerprint'),
      acquireCommandLock: jest.fn().mockResolvedValue(undefined),
      findReplay: jest.fn().mockResolvedValue(null),
      completionTimes: jest.fn((date: Date) => ({
        completedAt: date,
        expiresAt: new Date(date.getTime() + 24 * 60 * 60 * 1000),
      })),
    };
    const otpOutbox = {
      createBookingOtpOutbox: jest.fn().mockResolvedValue(undefined),
    };
    const notificationPayload = {
      encryptMessage: jest.fn().mockReturnValue('encrypted-message'),
    };

    const service = new AppointmentRecoveryService(
      prisma as never,
      mobileNumber as never,
      otpGenerator,
      otpService as never,
      idempotency as never,
      otpOutbox as never,
      notificationPayload as never,
    );

    return {
      service,
      prisma,
      mobileNumber,
      otpOutbox,
      idempotency,
      notificationPayload,
    };
  }

  it('keeps the request response neutral while binding a unique eligible candidate internally', async () => {
    const attemptCreate = jest.fn().mockResolvedValue({
      id: '11111111-1111-4111-8111-111111111111',
      expiresAt: new Date('2026-08-23T01:15:00.000Z'),
    });
    const transaction = {
      appointment: {
        findMany: jest.fn().mockResolvedValue([{ id: 'appointment-1' }]),
      },
      bookingRecoveryAttempt: { create: attemptCreate },
      otpVerification: {
        findFirst: jest.fn().mockResolvedValue(null),
        count: jest.fn().mockResolvedValue(0),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        create: jest.fn().mockResolvedValue({ id: 'otp-1' }),
      },
    };
    const { service, otpOutbox } = buildService(transaction);

    const result = await service.request({
      practiceLocationPublicIdentifier: 'north-clinic',
      serviceDate: '2026-08-23',
      mobileNumber: '+639171234567',
    });

    expect(result.message).toBe(
      'If the appointment can be recovered, verification will continue.',
    );
    expect(result).not.toHaveProperty('candidateAppointmentId');
    expect(attemptCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          candidateAppointmentId: 'appointment-1',
        }),
      }),
    );
    expect(otpOutbox.createBookingOtpOutbox).toHaveBeenCalledTimes(1);
  });

  it('rejects a verified candidate without changing the appointment or issuing access', async () => {
    const updateAttempt = jest.fn().mockResolvedValue({ id: 'attempt-1' });
    const transaction = {
      $queryRaw: jest.fn().mockResolvedValue([
        {
          id: 'attempt-1',
          practiceLocationId: 'location-1',
          serviceDate: new Date('2026-08-23T00:00:00.000Z'),
          mobileNumberEncrypted: 'encrypted-mobile',
          mobileNumberHash: 'mobile-hash',
          candidateAppointmentId: 'appointment-1',
          status: BookingRecoveryAttemptStatus.VERIFIED,
          expiresAt: new Date(Date.now() + 60_000),
          completedAt: null,
        },
      ]),
      otpVerification: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      bookingRecoveryAttempt: { update: updateAttempt },
      appointment: { update: jest.fn() },
      bookingAccessToken: { create: jest.fn(), updateMany: jest.fn() },
    };
    const { service } = buildService(transaction);

    const result = await service.reject('attempt-1');

    expect(result.rejected).toBe(true);
    expect(updateAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: BookingRecoveryAttemptStatus.REJECTED,
        }),
      }),
    );
    expect(transaction.appointment.update).not.toHaveBeenCalled();
    expect(transaction.bookingAccessToken.create).not.toHaveBeenCalled();
    expect(transaction.bookingAccessToken.updateMany).not.toHaveBeenCalled();
  });

  it('atomically replaces patient access while preserving the existing Appointment and Queue Number', async () => {
    process.env.PUBLIC_APP_BASE_URL = 'http://localhost:5173';
    const serviceDate = new Date('2026-08-23T00:00:00.000Z');
    const attempt = {
      id: 'attempt-1',
      practiceLocationId: 'location-1',
      serviceDate,
      mobileNumberEncrypted: 'encrypted-mobile',
      mobileNumberHash: 'mobile-hash',
      candidateAppointmentId: 'appointment-1',
      status: BookingRecoveryAttemptStatus.VERIFIED,
      expiresAt: new Date(Date.now() + 60_000),
      completedAt: null,
    };
    const revokeTokens = jest.fn().mockResolvedValue({ count: 2 });
    const createToken = jest
      .fn()
      .mockResolvedValue({ id: 'replacement-token' });
    const updateAttempt = jest.fn().mockResolvedValue({ id: 'attempt-1' });
    const transaction = {
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([attempt])
        .mockResolvedValueOnce([
          {
            id: 'appointment-1',
            bookingReference: 'CQ-G3X2C2',
            practiceLocationId: 'location-1',
            serviceDate,
            queueNumber: 1,
            mobileNumberHash: 'mobile-hash',
            anonymizedAt: null,
          },
        ]),
      bookingRecoveryAttempt: { update: updateAttempt },
      otpVerification: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'otp-1',
          expiresAt: new Date(Date.now() + 60_000),
        }),
        update: jest.fn().mockResolvedValue({ id: 'otp-1' }),
      },
      bookingAccessToken: { updateMany: revokeTokens, create: createToken },
      commandIdempotency: {
        create: jest.fn().mockResolvedValue({ id: 'command-1' }),
      },
      notificationOutbox: {
        create: jest.fn().mockResolvedValue({ id: 'outbox-1' }),
      },
      appointment: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
    };
    const { service, idempotency, notificationPayload } =
      buildService(transaction);

    const result = await service.confirmAndComplete('attempt-1', 'idem-1');

    expect(result.appointment).toEqual({
      bookingReference: 'CQ-G3X2C2',
      queueNumber: 1,
    });
    expect(result.rawToken).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(revokeTokens).toHaveBeenCalledTimes(1);
    expect(createToken).toHaveBeenCalledTimes(1);
    expect(transaction.appointment.update).not.toHaveBeenCalled();
    expect(updateAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: BookingRecoveryAttemptStatus.CANDIDATE_CONFIRMED,
        }),
      }),
    );
    expect(updateAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: BookingRecoveryAttemptStatus.COMPLETED,
        }),
      }),
    );
    expect(idempotency.deriveIdentity).toHaveBeenCalledWith(
      expect.objectContaining({
        commandType: CommandType.COMPLETE_APPOINTMENT_RECOVERY,
      }),
    );
    expect(notificationPayload.encryptMessage).toHaveBeenCalledWith(
      expect.stringContaining('CQ-G3X2C2'),
    );
  });

  it('uses the dedicated APPOINTMENT_RECOVERY OTP purpose', () => {
    expect(OtpPurpose.APPOINTMENT_RECOVERY).toBe('APPOINTMENT_RECOVERY');
  });
});
