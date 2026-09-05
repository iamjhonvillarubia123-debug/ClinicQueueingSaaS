import {
  AdministrativeRestrictionStatus,
  PracticeLocationLifecycleStatus,
  UserAccountStatus,
  UserRole,
} from '../../generated/prisma/client';
import { ClinicSecretaryAuthorityService } from './clinic-secretary-authority.service';
import { ClinicSecretaryAuthorityBundle } from './secretary-authority.types';

describe('ClinicSecretaryAuthorityService direct existing Secretary assignment', () => {
  const passwords = { verify: jest.fn() };

  function buildTransaction() {
    return {
      $executeRaw: jest.fn().mockResolvedValue(0),
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([
          {
            id: 'clinic-1',
            doctorUserId: 'doctor-1',
            lifecycleStatus: PracticeLocationLifecycleStatus.ACTIVE,
            currentRegularPracticeStaffId: null,
          },
        ])
        .mockResolvedValueOnce([{ id: 'doctor-1' }, { id: 'secretary-1' }])
        .mockResolvedValueOnce([]),
      user: {
        findUnique: jest
          .fn()
          .mockResolvedValueOnce({
            id: 'doctor-1',
            role: UserRole.DOCTOR,
            accountStatus: UserAccountStatus.ACTIVE,
            administrativeRestrictionStatus: AdministrativeRestrictionStatus.NONE,
            passwordHash: 'doctor-hash',
          })
          .mockResolvedValueOnce({
            id: 'secretary-1',
            role: UserRole.SECRETARY,
            accountStatus: UserAccountStatus.ACTIVE,
            emailVerifiedAt: new Date('2026-09-05T00:00:00Z'),
          }),
      },
      commandIdempotency: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'command-1' }),
      },
      practiceStaffCapability: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        create: jest.fn().mockResolvedValue({ id: 'capability-1' }),
      },
      practiceLocation: {
        update: jest.fn().mockResolvedValue({ id: 'clinic-1' }),
      },
    };
  }

  function buildService(transaction: ReturnType<typeof buildTransaction>) {
    const prisma = {
      $transaction: jest.fn((callback: (tx: unknown) => unknown) =>
        Promise.resolve(callback(transaction)),
      ),
    };
    return new ClinicSecretaryAuthorityService(
      prisma as never,
      passwords as never,
    );
  }

  beforeEach(() => jest.clearAllMocks());

  it('creates the relationship, authority bundles, and Cancel Clinic Day capability in one transaction', async () => {
    const transaction = buildTransaction();
    passwords.verify.mockResolvedValue(true);
    const service = buildService(transaction);

    await expect(
      service.assign(
        'doctor-1',
        {
          practiceLocationId: 'clinic-1',
          userId: 'secretary-1',
          authorityBundles: [
            ClinicSecretaryAuthorityBundle.QUEUE_AND_CLINIC_DAY_OPERATIONS,
          ],
          requestedCancelClinicDay: true,
          password: 'DoctorPass1!',
        },
        'assign-existing-secretary',
      ),
    ).resolves.toEqual(
      expect.objectContaining({
        assigned: true,
        replayed: false,
        cancelClinicDayAllowed: true,
      }),
    );

    expect(passwords.verify).toHaveBeenCalledWith(
      'DoctorPass1!',
      'doctor-hash',
    );
    expect(transaction.practiceStaffCapability.create).toHaveBeenCalledTimes(1);
    const capability = transaction.practiceStaffCapability.create.mock.calls[0][0]
      .data as { activeCapabilityKey: string; capabilityType: string };
    expect(capability.capabilityType).toBe('CANCEL_CLINIC_DAY');
    expect(capability.activeCapabilityKey).toHaveLength(64);
    expect(transaction.practiceLocation.update).toHaveBeenCalledTimes(1);
    expect(transaction.commandIdempotency.create).toHaveBeenCalledTimes(1);
  });

  it('does not create the sensitive capability when it was not granted', async () => {
    const transaction = buildTransaction();
    const service = buildService(transaction);

    await service.assign(
      'doctor-1',
      {
        practiceLocationId: 'clinic-1',
        userId: 'secretary-1',
        authorityBundles: [
          ClinicSecretaryAuthorityBundle.APPOINTMENTS_AND_PATIENT_INTAKE,
        ],
        requestedCancelClinicDay: false,
      },
      'assign-existing-secretary-without-cancel',
    );

    expect(passwords.verify).not.toHaveBeenCalled();
    expect(transaction.practiceStaffCapability.create).not.toHaveBeenCalled();
  });
});
