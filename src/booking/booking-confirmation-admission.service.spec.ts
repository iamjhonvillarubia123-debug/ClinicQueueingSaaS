import { ConflictException } from '@nestjs/common';
import { PublicServiceDateAvailabilityService } from '../schedule/public-service-date-availability.service';
import { ActiveBookingIdentityService } from './active-booking-identity.service';
import { BookingConfirmationAdmissionService } from './booking-confirmation-admission.service';

describe('BookingConfirmationAdmissionService', () => {
  const resolveAvailability = jest.fn();
  const deriveAppointmentKey = jest.fn(() => 'a'.repeat(64));
  const acquireAppointmentScopeLock = jest.fn();
  const assertNoActiveAppointment = jest.fn();

  const availability = {
    resolve: resolveAvailability,
  } as unknown as PublicServiceDateAvailabilityService;
  const activeBookingIdentity = {
    deriveAppointmentKey,
    acquireAppointmentScopeLock,
    assertNoActiveAppointment,
  } as unknown as ActiveBookingIdentityService;
  const service = new BookingConfirmationAdmissionService(
    availability,
    activeBookingIdentity,
  );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('accepts an active Doctor during subscription grace and protects duplicate scope', async () => {
    const now = new Date('2026-08-17T01:00:00.000Z');
    const transaction = transactionWithRows([
      [draftRow()],
      [doctorRow()],
      [{ graceEndsAt: new Date('2026-08-18T00:00:00.000Z') }],
      [verifiedOtpRow()],
    ]);
    resolveAvailability.mockResolvedValue({
      practiceLocationId: 'practice-1',
      serviceDate: '2026-08-20',
      availableForPublicBooking: true,
      reason: 'AVAILABLE',
      scheduleSource: 'PRACTICE_SCHEDULE',
      opensAt: new Date('2026-08-20T01:00:00.000Z'),
      closesAt: new Date('2026-08-20T09:00:00.000Z'),
      maximumOnlineBookingUntilAt: null,
      maximumOperatingUntilAt: new Date('2026-08-20T10:00:00.000Z'),
    });

    const result = await service.lockAndValidateCurrentAdmission(
      transaction as never,
      'draft-1',
      now,
    );

    expect(result.activeAppointmentKey).toBe('a'.repeat(64));
    expect(acquireAppointmentScopeLock).toHaveBeenCalled();
    expect(assertNoActiveAppointment).toHaveBeenCalled();
  });

  it('rejects unresolved subscription grace expiry before duplicate and queue work', async () => {
    const now = new Date('2026-08-17T01:00:00.000Z');
    const transaction = transactionWithRows([
      [draftRow()],
      [doctorRow()],
      [{ graceEndsAt: new Date('2026-08-17T00:59:59.000Z') }],
      [verifiedOtpRow()],
    ]);

    await expect(
      service.lockAndValidateCurrentAdmission(
        transaction as never,
        'draft-1',
        now,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(resolveAvailability).not.toHaveBeenCalled();
  });

  it('rejects a stale or unverified booking OTP', async () => {
    const now = new Date('2026-08-17T01:00:00.000Z');
    const transaction = transactionWithRows([
      [draftRow()],
      [doctorRow()],
      [{ graceEndsAt: new Date('2026-08-18T00:00:00.000Z') }],
      [],
    ]);

    await expect(
      service.lockAndValidateCurrentAdmission(
        transaction as never,
        'draft-1',
        now,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  function draftRow() {
    return {
      id: 'draft-1',
      mode: 'INDIVIDUAL',
      status: 'PENDING_OTP',
      practiceLocationId: 'practice-1',
      serviceDate: new Date('2026-08-20T00:00:00.000Z'),
      mobileNumberHash: 'mobile-hash',
      activeDraftKey: 'd'.repeat(64),
      expiresAt: new Date('2026-08-17T01:30:00.000Z'),
      consumedAt: null,
      cancelledAt: null,
      doctorProfileId: 'doctor-profile-1',
      doctorUserId: 'doctor-1',
    };
  }

  function doctorRow() {
    return {
      accountStatus: 'ACTIVE',
      administrativeRestrictionStatus: 'NONE',
    };
  }

  function verifiedOtpRow() {
    return {
      id: 'otp-1',
      verifiedAt: new Date('2026-08-17T00:59:00.000Z'),
      consumedAt: null,
      invalidatedAt: null,
      activeContextKey: 'BOOKING:draft-1',
    };
  }

  function transactionWithRows(rowBatches: unknown[][]) {
    const batches = [...rowBatches];
    return {
      $queryRaw: jest.fn(() => Promise.resolve(batches.shift() ?? [])),
      $executeRaw: jest.fn(() => Promise.resolve(1)),
    };
  }
});
