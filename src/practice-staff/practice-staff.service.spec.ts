import { createHash } from 'crypto';
import { UnauthorizedException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import {
  AdministrativeRestrictionStatus,
  ClinicDayOperatingStaffChangeType,
  ClinicDayStatus,
  PracticeLocationLifecycleStatus,
  PracticeStaffCapabilityStatus,
  PracticeStaffRole,
  UserAccountStatus,
  UserRole,
} from '../../generated/prisma/client';
import { PasswordSecurityService } from '../auth/security/password-security.service';
import { PrismaService } from '../prisma/prisma.service';
import { PracticeStaffService } from './practice-staff.service';

type MockTransaction = typeof prismaServiceMock;

const prismaServiceMock = {
  $transaction: jest.fn(),
  $executeRaw: jest.fn(),
  $queryRaw: jest.fn(),
  user: {
    findUnique: jest.fn(),
  },
  commandIdempotency: {
    findUnique: jest.fn(),
    create: jest.fn(),
  },
  practiceStaff: {
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  practiceLocation: {
    update: jest.fn(),
  },
  clinicDay: {
    update: jest.fn(),
  },
  clinicDayOperatingStaffAudit: {
    create: jest.fn(),
  },
  practiceStaffCapability: {
    updateMany: jest.fn(),
  },
};

const passwordSecurityServiceMock = {
  verify: jest.fn(),
};

describe('PracticeStaffService', () => {
  let service: PracticeStaffService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PracticeStaffService,
        {
          provide: PrismaService,
          useValue: prismaServiceMock,
        },
        {
          provide: PasswordSecurityService,
          useValue: passwordSecurityServiceMock,
        },
      ],
    }).compile();

    service = module.get<PracticeStaffService>(PracticeStaffService);

    jest.clearAllMocks();
    prismaServiceMock.$transaction.mockImplementation(
      async (callback: (transaction: MockTransaction) => Promise<unknown>) =>
        callback(prismaServiceMock),
    );
    prismaServiceMock.$executeRaw.mockResolvedValue(1);
    prismaServiceMock.commandIdempotency.findUnique.mockResolvedValue(null);
    prismaServiceMock.commandIdempotency.create.mockResolvedValue({
      id: 'command-1',
    });
    prismaServiceMock.practiceLocation.update.mockResolvedValue({});
    prismaServiceMock.clinicDay.update.mockResolvedValue({});
    prismaServiceMock.clinicDayOperatingStaffAudit.create.mockResolvedValue({});
    prismaServiceMock.practiceStaffCapability.updateMany.mockResolvedValue({
      count: 0,
    });
    passwordSecurityServiceMock.verify.mockResolvedValue(true);
  });

  it('assigns the first regular Secretary and immediately staffs an unstaffed STARTED ClinicDay', async () => {
    prismaServiceMock.$queryRaw
      .mockResolvedValueOnce([
        {
          id: 'location-1',
          doctorUserId: 'doctor-1',
          lifecycleStatus: PracticeLocationLifecycleStatus.ACTIVE,
          currentRegularPracticeStaffId: null,
        },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 'clinic-day-1',
          practiceLocationId: 'location-1',
          serviceDate: new Date('2026-08-15T00:00:00.000Z'),
          status: ClinicDayStatus.STARTED,
          operatingPracticeStaffId: null,
        },
      ]);
    prismaServiceMock.user.findUnique
      .mockResolvedValueOnce({
        id: 'doctor-1',
        role: UserRole.DOCTOR,
        accountStatus: UserAccountStatus.ACTIVE,
        administrativeRestrictionStatus: AdministrativeRestrictionStatus.NONE,
      })
      .mockResolvedValueOnce({
        id: 'secretary-1',
        role: UserRole.SECRETARY,
        accountStatus: UserAccountStatus.ACTIVE,
      });
    prismaServiceMock.practiceStaff.create.mockResolvedValue({
      id: 'staff-new',
      userId: 'secretary-1',
      practiceLocationId: 'location-1',
      staffRole: PracticeStaffRole.SECRETARY,
      isActive: true,
    });

    await expect(
      service.assignRegular(
        'doctor-1',
        { practiceLocationId: 'location-1', userId: 'secretary-1' },
        'assign-key',
      ),
    ).resolves.toEqual({
      assigned: true,
      replayed: false,
      practiceStaffId: 'staff-new',
    });

    expect(prismaServiceMock.practiceLocation.update).toHaveBeenCalledWith({
      where: { id: 'location-1' },
      data: { currentRegularPracticeStaffId: 'staff-new' },
    });
    expect(prismaServiceMock.clinicDay.update).toHaveBeenCalledWith({
      where: { id: 'clinic-day-1' },
      data: { operatingPracticeStaffId: 'staff-new' },
    });
    expect(
      prismaServiceMock.clinicDayOperatingStaffAudit.create,
    ).toHaveBeenCalledWith({
      data: expect.objectContaining({
        clinicDayId: 'clinic-day-1',
        changeType: ClinicDayOperatingStaffChangeType.ASSIGNED,
        previousOperatingPracticeStaffId: null,
        newOperatingPracticeStaffId: 'staff-new',
        actorUserId: 'doctor-1',
      }) as Record<string, unknown>,
    });
  });

  it('replaces the current regular Secretary atomically, hands off STARTED ClinicDay, and clears future operating assignment', async () => {
    prismaServiceMock.$queryRaw
      .mockResolvedValueOnce([
        {
          id: 'location-1',
          doctorUserId: 'doctor-1',
          lifecycleStatus: PracticeLocationLifecycleStatus.ACTIVE,
          currentRegularPracticeStaffId: 'staff-old',
        },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 'staff-old',
          userId: 'secretary-old',
          practiceLocationId: 'location-1',
          staffRole: PracticeStaffRole.SECRETARY,
          isActive: true,
        },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 'clinic-day-live',
          practiceLocationId: 'location-1',
          serviceDate: new Date('2026-08-15T00:00:00.000Z'),
          status: ClinicDayStatus.STARTED,
          operatingPracticeStaffId: 'staff-old',
        },
        {
          id: 'clinic-day-future',
          practiceLocationId: 'location-1',
          serviceDate: new Date('2026-08-16T00:00:00.000Z'),
          status: ClinicDayStatus.NOT_STARTED,
          operatingPracticeStaffId: 'staff-old',
        },
      ]);
    prismaServiceMock.user.findUnique
      .mockResolvedValueOnce({
        id: 'doctor-1',
        role: UserRole.DOCTOR,
        accountStatus: UserAccountStatus.ACTIVE,
        administrativeRestrictionStatus: AdministrativeRestrictionStatus.NONE,
        passwordHash: 'doctor-hash',
      })
      .mockResolvedValueOnce({
        id: 'secretary-new',
        role: UserRole.SECRETARY,
        accountStatus: UserAccountStatus.ACTIVE,
      });
    prismaServiceMock.practiceStaff.create.mockResolvedValue({
      id: 'staff-new',
      userId: 'secretary-new',
      practiceLocationId: 'location-1',
      staffRole: PracticeStaffRole.SECRETARY,
      isActive: true,
    });
    prismaServiceMock.practiceStaff.update.mockResolvedValue({});

    await expect(
      service.replaceRegular(
        'doctor-1',
        {
          practiceLocationId: 'location-1',
          userId: 'secretary-new',
          password: 'DoctorPassword123!',
        },
        'replace-key',
      ),
    ).resolves.toEqual({
      replaced: true,
      replayed: false,
      practiceStaffId: 'staff-new',
    });

    expect(prismaServiceMock.clinicDay.update).toHaveBeenNthCalledWith(1, {
      where: { id: 'clinic-day-live' },
      data: { operatingPracticeStaffId: 'staff-new' },
    });
    expect(prismaServiceMock.clinicDay.update).toHaveBeenNthCalledWith(2, {
      where: { id: 'clinic-day-future' },
      data: { operatingPracticeStaffId: null },
    });
    expect(
      prismaServiceMock.clinicDayOperatingStaffAudit.create,
    ).toHaveBeenNthCalledWith(1, {
      data: expect.objectContaining({
        changeType: ClinicDayOperatingStaffChangeType.REPLACED,
        previousOperatingPracticeStaffId: 'staff-old',
        newOperatingPracticeStaffId: 'staff-new',
      }) as Record<string, unknown>,
    });
    expect(
      prismaServiceMock.clinicDayOperatingStaffAudit.create,
    ).toHaveBeenNthCalledWith(2, {
      data: expect.objectContaining({
        changeType: ClinicDayOperatingStaffChangeType.CLEARED,
        previousOperatingPracticeStaffId: 'staff-old',
        newOperatingPracticeStaffId: null,
      }) as Record<string, unknown>,
    });
    expect(prismaServiceMock.practiceStaff.update).toHaveBeenCalledWith({
      where: { id: 'staff-old' },
      data: { isActive: false },
    });
    expect(
      prismaServiceMock.practiceStaffCapability.updateMany,
    ).toHaveBeenCalledWith({
      where: {
        practiceStaffId: 'staff-old',
        status: PracticeStaffCapabilityStatus.ACTIVE,
      },
      data: expect.objectContaining({
        status: PracticeStaffCapabilityStatus.REVOKED,
        revokedByUserId: 'doctor-1',
      }) as Record<string, unknown>,
    });
  });

  it('removes the regular Secretary, clears operating authority, and leaves the Doctor in control', async () => {
    prismaServiceMock.$queryRaw
      .mockResolvedValueOnce([
        {
          id: 'location-1',
          doctorUserId: 'doctor-1',
          lifecycleStatus: PracticeLocationLifecycleStatus.ACTIVE,
          currentRegularPracticeStaffId: 'staff-old',
        },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 'staff-old',
          userId: 'secretary-old',
          practiceLocationId: 'location-1',
          staffRole: PracticeStaffRole.SECRETARY,
          isActive: true,
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 'clinic-day-live',
          practiceLocationId: 'location-1',
          serviceDate: new Date('2026-08-15T00:00:00.000Z'),
          status: ClinicDayStatus.STARTED,
          operatingPracticeStaffId: 'staff-old',
        },
      ]);
    prismaServiceMock.user.findUnique.mockResolvedValue({
      id: 'doctor-1',
      role: UserRole.DOCTOR,
      accountStatus: UserAccountStatus.ACTIVE,
      administrativeRestrictionStatus: AdministrativeRestrictionStatus.NONE,
      passwordHash: 'doctor-hash',
    });
    prismaServiceMock.practiceStaff.update.mockResolvedValue({});

    await expect(
      service.removeRegular(
        'doctor-1',
        {
          practiceLocationId: 'location-1',
          password: 'DoctorPassword123!',
        },
        'remove-key',
      ),
    ).resolves.toEqual({ removed: true, replayed: false });

    expect(prismaServiceMock.practiceLocation.update).toHaveBeenCalledWith({
      where: { id: 'location-1' },
      data: { currentRegularPracticeStaffId: null },
    });
    expect(prismaServiceMock.clinicDay.update).toHaveBeenCalledWith({
      where: { id: 'clinic-day-live' },
      data: { operatingPracticeStaffId: null },
    });
    expect(
      prismaServiceMock.clinicDayOperatingStaffAudit.create,
    ).toHaveBeenCalledWith({
      data: expect.objectContaining({
        changeType: ClinicDayOperatingStaffChangeType.CLEARED,
        actorUserId: 'doctor-1',
      }) as Record<string, unknown>,
    });
  });

  it('rejects replacement when the Doctor current password is invalid before staffing effects', async () => {
    prismaServiceMock.$queryRaw
      .mockResolvedValueOnce([
        {
          id: 'location-1',
          doctorUserId: 'doctor-1',
          lifecycleStatus: PracticeLocationLifecycleStatus.ACTIVE,
          currentRegularPracticeStaffId: 'staff-old',
        },
      ])
      .mockResolvedValueOnce([]);
    prismaServiceMock.user.findUnique
      .mockResolvedValueOnce({
        id: 'doctor-1',
        role: UserRole.DOCTOR,
        accountStatus: UserAccountStatus.ACTIVE,
        administrativeRestrictionStatus: AdministrativeRestrictionStatus.NONE,
        passwordHash: 'doctor-hash',
      })
      .mockResolvedValueOnce({
        id: 'secretary-new',
        role: UserRole.SECRETARY,
        accountStatus: UserAccountStatus.ACTIVE,
      });
    passwordSecurityServiceMock.verify.mockResolvedValue(false);

    await expect(
      service.replaceRegular(
        'doctor-1',
        {
          practiceLocationId: 'location-1',
          userId: 'secretary-new',
          password: 'wrong-password',
        },
        'replace-key',
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(prismaServiceMock.practiceLocation.update).not.toHaveBeenCalled();
    expect(prismaServiceMock.commandIdempotency.create).not.toHaveBeenCalled();
  });

  it('replays a committed regular Secretary assignment without repeating staffing effects', async () => {
    prismaServiceMock.$queryRaw
      .mockResolvedValueOnce([
        {
          id: 'location-1',
          doctorUserId: 'doctor-1',
          lifecycleStatus: PracticeLocationLifecycleStatus.ACTIVE,
          currentRegularPracticeStaffId: 'staff-1',
        },
      ])
      .mockResolvedValueOnce([]);
    prismaServiceMock.user.findUnique
      .mockResolvedValueOnce({
        id: 'doctor-1',
        role: UserRole.DOCTOR,
        accountStatus: UserAccountStatus.ACTIVE,
        administrativeRestrictionStatus: AdministrativeRestrictionStatus.NONE,
      })
      .mockResolvedValueOnce({
        id: 'secretary-1',
        role: UserRole.SECRETARY,
        accountStatus: UserAccountStatus.ACTIVE,
      });
    prismaServiceMock.commandIdempotency.findUnique.mockResolvedValue({
      requestFingerprint: createHash('sha256')
        .update(
          'PRACTICE_LOCATION_ASSIGN_REGULAR_SECRETARY|doctor-1|location-1|secretary-1',
          'utf8',
        )
        .digest('hex'),
    });
    prismaServiceMock.practiceStaff.findFirst.mockResolvedValue({
      id: 'staff-1',
    });

    await expect(
      service.assignRegular(
        'doctor-1',
        { practiceLocationId: 'location-1', userId: 'secretary-1' },
        'assign-key',
      ),
    ).resolves.toEqual({
      assigned: true,
      replayed: true,
      practiceStaffId: 'staff-1',
    });

    expect(prismaServiceMock.practiceLocation.update).not.toHaveBeenCalled();
    expect(prismaServiceMock.clinicDay.update).not.toHaveBeenCalled();
    expect(prismaServiceMock.commandIdempotency.create).not.toHaveBeenCalled();
  });
});
