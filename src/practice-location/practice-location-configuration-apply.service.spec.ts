import { ConflictException, UnauthorizedException } from '@nestjs/common';
import {
  AdministrativeRestrictionStatus,
  PracticeLocationLifecycleStatus,
  UserAccountStatus,
  UserRole,
} from '../../generated/prisma/client';
import { PracticeLocationConfigurationApplyService } from './practice-location-configuration-apply.service';

describe('PracticeLocationConfigurationApplyService', () => {
  const passwordSecurity = { verify: jest.fn() };
  const recurringScheduleConflict = {
    assertNoConflictForLocation: jest.fn(),
  };
  const scheduleTime = { assertValidTimeZone: jest.fn() };

  function buildTransaction(
    status: PracticeLocationLifecycleStatus = PracticeLocationLifecycleStatus.ACTIVE,
  ) {
    const transaction = {
      $executeRaw: jest.fn().mockResolvedValue(0),
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([
          {
            id: 'location-1',
            doctorProfileId: 'doctor-profile-1',
            doctorUserId: 'doctor-1',
            lifecycleStatus: status,
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
      },
      doctorPracticeScheduleDraft: {
        findUnique: jest.fn(),
      },
    };
    return transaction;
  }

  function buildService(transaction: ReturnType<typeof buildTransaction>) {
    const prisma = {
      $transaction: jest.fn((callback: (tx: unknown) => unknown) =>
        Promise.resolve(callback(transaction)),
      ),
    };
    return new PracticeLocationConfigurationApplyService(
      prisma as never,
      passwordSecurity as never,
      recurringScheduleConflict as never,
      scheduleTime as never,
    );
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('rejects an incorrect current password before loading or changing the draft', async () => {
    const transaction = buildTransaction();
    passwordSecurity.verify.mockResolvedValue(false);
    const service = buildService(transaction);

    await expect(
      service.apply(
        'doctor-1',
        {
          practiceLocationId: 'location-1',
          password: 'wrong-password',
          confirmApply: true,
        },
        'apply-key-1',
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(passwordSecurity.verify).toHaveBeenCalledWith(
      'wrong-password',
      'stored-hash',
    );
    expect(
      transaction.doctorPracticeScheduleDraft.findUnique,
    ).not.toHaveBeenCalled();
  });

  it('rejects Apply Changes when the clinic lifecycle is not active or disabled', async () => {
    const transaction = buildTransaction(PracticeLocationLifecycleStatus.DRAFT);
    passwordSecurity.verify.mockResolvedValue(true);
    const service = buildService(transaction);

    await expect(
      service.apply(
        'doctor-1',
        {
          practiceLocationId: 'location-1',
          password: 'password',
          confirmApply: true,
        },
        'apply-key-2',
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(passwordSecurity.verify).not.toHaveBeenCalled();
    expect(
      transaction.doctorPracticeScheduleDraft.findUnique,
    ).not.toHaveBeenCalled();
  });

  it('preserves effective configuration when there is no proposed draft to apply', async () => {
    const transaction = buildTransaction();
    transaction.doctorPracticeScheduleDraft.findUnique.mockResolvedValue(null);
    passwordSecurity.verify.mockResolvedValue(true);
    const service = buildService(transaction);

    await expect(
      service.apply(
        'doctor-1',
        {
          practiceLocationId: 'location-1',
          password: 'password',
          confirmApply: true,
        },
        'apply-key-3',
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(
      transaction.doctorPracticeScheduleDraft.findUnique,
    ).toHaveBeenCalledTimes(1);
    expect(
      recurringScheduleConflict.assertNoConflictForLocation,
    ).not.toHaveBeenCalled();
  });
});
