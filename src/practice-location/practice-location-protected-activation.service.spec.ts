import { UnauthorizedException } from '@nestjs/common';
import {
  AdministrativeRestrictionStatus,
  PracticeLocationLifecycleStatus,
  UserAccountStatus,
  UserRole,
} from '../../generated/prisma/client';
import { PracticeLocationProtectedActivationService } from './practice-location-protected-activation.service';

describe('PracticeLocationProtectedActivationService', () => {
  const passwordSecurity = { verify: jest.fn() };
  const recurringScheduleConflict = {
    assertNoConflictForLocation: jest.fn(),
  };
  const scheduleTime = { assertValidTimeZone: jest.fn() };

  function buildTransaction() {
    return {
      $executeRaw: jest.fn().mockResolvedValue(0),
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([
          {
            id: 'location-1',
            doctorProfileId: 'doctor-profile-1',
            doctorUserId: 'doctor-1',
            lifecycleStatus: PracticeLocationLifecycleStatus.DRAFT,
            name: 'Clinic A',
            addressLine1: '123 Main St',
            timeZone: 'Asia/Manila',
          },
        ])
        .mockResolvedValueOnce([{ id: 'doctor-1' }]),
      user: {
        findUnique: jest.fn().mockResolvedValue({
          role: UserRole.DOCTOR,
          accountStatus: UserAccountStatus.ACTIVE,
          administrativeRestrictionStatus: AdministrativeRestrictionStatus.NONE,
          passwordHash: 'stored-hash',
        }),
      },
      commandIdempotency: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'command-1' }),
      },
      practiceLocation: {
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn().mockResolvedValue({ id: 'location-1' }),
      },
      practiceSchedule: {
        findMany: jest.fn().mockResolvedValue([
          {
            isOpen: true,
            opensAtLocal: new Date('1970-01-01T09:00:00.000Z'),
            closesAtLocal: new Date('1970-01-01T17:00:00.000Z'),
            maximumOperatingUntilLocal: new Date('1970-01-01T17:00:00.000Z'),
          },
        ]),
      },
    };
  }

  function buildService(transaction: ReturnType<typeof buildTransaction>) {
    const prisma = {
      $transaction: jest.fn((callback: (tx: unknown) => unknown) =>
        Promise.resolve(callback(transaction)),
      ),
    };
    return new PracticeLocationProtectedActivationService(
      prisma as never,
      passwordSecurity as never,
      recurringScheduleConflict as never,
      scheduleTime as never,
    );
  }

  beforeEach(() => jest.clearAllMocks());

  it('rejects an incorrect current password without activating', async () => {
    const transaction = buildTransaction();
    passwordSecurity.verify.mockResolvedValue(false);
    const service = buildService(transaction);

    await expect(
      service.activate(
        'doctor-1',
        {
          practiceLocationId: 'location-1',
          password: 'wrong-password',
          confirmActivation: true,
        },
        'activation-key',
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(transaction.practiceLocation.update).not.toHaveBeenCalled();
    expect(transaction.commandIdempotency.create).not.toHaveBeenCalled();
  });

  it('activates atomically after password and schedule validation', async () => {
    const transaction = buildTransaction();
    passwordSecurity.verify.mockResolvedValue(true);
    const service = buildService(transaction);

    await expect(
      service.activate(
        'doctor-1',
        {
          practiceLocationId: 'location-1',
          password: 'correct-password',
          confirmActivation: true,
        },
        'activation-key',
      ),
    ).resolves.toEqual({ activated: true, replayed: false });

    expect(passwordSecurity.verify).toHaveBeenCalledWith(
      'correct-password',
      'stored-hash',
    );
    expect(
      recurringScheduleConflict.assertNoConflictForLocation,
    ).toHaveBeenCalled();
    expect(transaction.practiceLocation.update).toHaveBeenCalledWith({
      where: { id: 'location-1' },
      data: { lifecycleStatus: PracticeLocationLifecycleStatus.ACTIVE },
    });
    expect(transaction.commandIdempotency.create).toHaveBeenCalledTimes(1);
    expect(transaction.$executeRaw).toHaveBeenCalled();
  });
});
