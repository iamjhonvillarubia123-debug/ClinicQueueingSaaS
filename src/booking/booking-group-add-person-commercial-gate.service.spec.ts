import { ConflictException, ForbiddenException } from '@nestjs/common';
import { BookingGroupAddPersonService } from './booking-group-add-person.service';

describe('BookingGroupAddPersonService commercial suspension', () => {
  it('blocks new Appointment creation with neutral patient-facing wording', async () => {
    const serviceDate = new Date('2026-08-25T00:00:00.000Z');
    const group = {
      id: 'group-1',
      practiceLocationId: 'location-1',
      serviceDate,
      servingProtectionEndedAt: null,
      controllingMobileNumberEncrypted: 'encrypted-mobile',
      doctorUserId: 'doctor-1',
    };
    const transaction = {
      bookingGroup: {
        findUnique: jest.fn(() =>
          Promise.resolve({
            practiceLocationId: 'location-1',
            serviceDate,
          }),
        ),
      },
      appointment: {
        findUnique: jest.fn(),
        count: jest.fn(),
        create: jest.fn(),
      },
      $executeRaw: jest.fn(() => Promise.resolve(0)),
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([group])
        .mockResolvedValueOnce([]),
    };
    const prisma = {
      $transaction: <T>(callback: (tx: typeof transaction) => Promise<T>) =>
        callback(transaction),
    };
    const groupAccess = {
      validateControllerToken: jest.fn(() => Promise.resolve()),
    };
    const idempotency = {
      normalizeKey: jest.fn(() => 'key-1'),
      deriveIdentity: jest.fn(() => 'identity-1'),
      fingerprint: jest.fn(() => 'fingerprint-1'),
      acquireCommandLock: jest.fn(() => Promise.resolve()),
      findReplay: jest.fn(() => Promise.resolve(null)),
    };
    const commercialGate = {
      assertAllowsNewActivityInTransaction: jest.fn(() =>
        Promise.reject(
          new ForbiddenException(
            'Subscription entitlement does not allow new activity.',
          ),
        ),
      ),
    };
    const service = new BookingGroupAddPersonService(
      prisma as never,
      groupAccess as never,
      idempotency as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      commercialGate as never,
    );

    const result = service.addPerson(
      'group-1',
      'group-token',
      {
        firstName: 'Blocked',
        lastName: 'Member',
        existingPatientResponse: 'NO',
        selectedServiceIds: ['service-1'],
        answers: [],
      },
      'key-1',
    );

    await expect(result).rejects.toEqual(
      expect.objectContaining({
        constructor: ConflictException,
        message: 'Add Person is currently unavailable.',
      }),
    );
    expect(
      commercialGate.assertAllowsNewActivityInTransaction,
    ).toHaveBeenCalledWith(transaction, 'doctor-1', expect.any(Date));
    expect(transaction.appointment.count).not.toHaveBeenCalled();
    expect(transaction.appointment.create).not.toHaveBeenCalled();
  });
});
