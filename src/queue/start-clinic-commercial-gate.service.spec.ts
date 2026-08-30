import { ForbiddenException } from '@nestjs/common';
import {
  AdministrativeRestrictionStatus,
  PracticeLocationLifecycleStatus,
  UserAccountStatus,
  UserRole,
} from '../../generated/prisma/client';
import { StartClinicService } from './start-clinic.service';

describe('StartClinicService commercial suspension', () => {
  it('blocks a new ClinicDay before STARTED mutation when entitlement is suspended', async () => {
    const context = {
      practiceLocationId: 'location-1',
      lifecycleStatus: PracticeLocationLifecycleStatus.ACTIVE,
      doctorUserId: 'doctor-1',
      currentRegularPracticeStaffId: null,
    };
    const transaction = {
      $executeRaw: jest.fn(() => Promise.resolve(0)),
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([context])
        .mockResolvedValueOnce([{ id: 'doctor-1' }])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]),
      user: {
        findUnique: jest.fn(() =>
          Promise.resolve({
            id: 'doctor-1',
            role: UserRole.DOCTOR,
            accountStatus: UserAccountStatus.ACTIVE,
            administrativeRestrictionStatus:
              AdministrativeRestrictionStatus.NONE,
          }),
        ),
      },
      clinicDay: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      queueEvent: { create: jest.fn() },
      queueEventAppointmentLink: {
        findFirst: jest.fn(),
        create: jest.fn(),
      },
      appointment: { update: jest.fn() },
      commandIdempotency: { create: jest.fn() },
    };
    const prisma = {
      $transaction: <T>(callback: (tx: typeof transaction) => Promise<T>) =>
        callback(transaction),
    };
    const idempotency = {
      normalizeKey: jest.fn(() => 'key-1'),
      deriveIdentity: jest.fn(() => 'identity-1'),
      fingerprint: jest.fn(() => 'fingerprint-1'),
      acquireCommandLock: jest.fn(() => Promise.resolve()),
      findReplay: jest.fn(() => Promise.resolve(null)),
    };
    const scheduleResolution = {
      resolveOperationalSchedule: jest.fn(() =>
        Promise.resolve({
          isOpen: true,
          maximumOnlineBookingUntilAt: new Date('2026-08-20T10:00:00.000Z'),
        }),
      ),
    };
    const scheduleTime = {
      parseServiceDate: jest.fn(() => ({ year: 2026, month: 8, day: 20 })),
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
    const service = new StartClinicService(
      prisma as never,
      idempotency as never,
      scheduleResolution as never,
      scheduleTime as never,
      commercialGate as never,
    );

    await expect(
      service.start(
        'doctor-1',
        { practiceLocationId: 'location-1', serviceDate: '2026-08-20' },
        'key-1',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(
      commercialGate.assertAllowsNewActivityInTransaction,
    ).toHaveBeenCalledWith(transaction, 'doctor-1', expect.any(Date));
    expect(transaction.clinicDay.create).not.toHaveBeenCalled();
    expect(transaction.clinicDay.update).not.toHaveBeenCalled();
    expect(transaction.queueEvent.create).not.toHaveBeenCalled();
    expect(transaction.commandIdempotency.create).not.toHaveBeenCalled();
  });
});
