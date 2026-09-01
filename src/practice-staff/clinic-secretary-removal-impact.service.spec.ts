import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import { PasswordSecurityService } from '../auth/security/password-security.service';
import { PrismaService } from '../prisma/prisma.service';
import { ClinicSecretaryAuthorityService } from './clinic-secretary-authority.service';
import { ClinicSecretaryAuthorityBundle } from './secretary-authority.types';

describe('ClinicSecretaryAuthorityService removal impact', () => {
  const prisma = {
    practiceStaff: { findFirst: jest.fn(), update: jest.fn() },
    practiceLocation: { update: jest.fn() },
    practiceStaffCapability: { updateMany: jest.fn() },
    practiceStaffAuthorityBundle: { updateMany: jest.fn() },
    substituteSecretaryCoverage: {
      findMany: jest.fn(),
      updateMany: jest.fn(),
    },
    substituteSecretaryCoverageDate: { updateMany: jest.fn() },
    user: { findUnique: jest.fn() },
    clinicDay: { findMany: jest.fn(), update: jest.fn() },
    clinicDayOperatingStaffAudit: { create: jest.fn() },
    appointment: { count: jest.fn() },
    $queryRaw: jest.fn(),
    $executeRaw: jest.fn(),
    $transaction: jest.fn(),
  };
  const passwords = { verify: jest.fn() };
  const service = new ClinicSecretaryAuthorityService(
    prisma as unknown as PrismaService,
    passwords as unknown as PasswordSecurityService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.$transaction.mockImplementation(
      async (callback: (transaction: typeof prisma) => Promise<unknown>) =>
        callback(prisma),
    );
  });

  it('reports clinic-day, booking, coverage, draft, and staffing consequences', async () => {
    prisma.practiceStaff.findFirst.mockResolvedValue({
      id: 'staff-1',
      isActive: true,
      practiceLocationId: 'clinic-1',
      practiceLocation: {
        name: 'North Clinic',
        currentRegularPracticeStaffId: 'staff-1',
      },
      substituteSecretaryCoverages: [
        {
          id: 'coverage-1',
          coverageMode: 'ONE_SERVICE_DATE',
          fromServiceDate: new Date('2026-09-02T00:00:00.000Z'),
          toServiceDate: new Date('2026-09-02T00:00:00.000Z'),
        },
      ],
      authoredSecretarySettingsDrafts: [{ id: 'draft-1', status: 'SUBMITTED' }],
    });
    prisma.clinicDay.findMany.mockResolvedValue([
      {
        id: 'day-1',
        serviceDate: new Date('2026-09-02T00:00:00.000Z'),
        status: 'NOT_STARTED',
      },
    ]);
    prisma.appointment.count.mockResolvedValue(4);

    const result = await service.getRemovalImpact('doctor-1', 'staff-1');

    expect(prisma.practiceStaff.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'staff-1',
          disconnectedAt: null,
          practiceLocation: {
            doctorProfile: { userId: 'doctor-1' },
          },
        }) as unknown,
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        clinicWillHaveNoCurrentSecretary: true,
        bookedAppointmentCount: 4,
        pendingConfigurationDraftCount: 1,
        bookingsRemainScheduled: true,
        auditHistoryPreserved: true,
      }),
    );
  });

  it('updates authority bundles for the owned active Clinic Secretary', async () => {
    prisma.practiceStaff.findFirst.mockResolvedValue({
      id: 'staff-1',
      practiceLocationId: 'clinic-1',
    });
    prisma.$queryRaw
      .mockResolvedValueOnce([
        {
          id: 'clinic-1',
          doctorUserId: 'doctor-1',
          lifecycleStatus: 'ACTIVE',
          currentRegularPracticeStaffId: 'staff-1',
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 'staff-1',
          userId: 'secretary-1',
          practiceLocationId: 'clinic-1',
          staffRole: 'SECRETARY',
          isActive: true,
        },
      ]);
    prisma.user.findUnique.mockResolvedValue({
      id: 'doctor-1',
      role: 'DOCTOR',
      accountStatus: 'ACTIVE',
      administrativeRestrictionStatus: 'NONE',
    });

    await expect(
      service.updateAuthority('doctor-1', 'staff-1', {
        authorityBundles: [
          ClinicSecretaryAuthorityBundle.QUEUE_AND_CLINIC_DAY_OPERATIONS,
          ClinicSecretaryAuthorityBundle.APPOINTMENTS_AND_PATIENT_INTAKE,
        ],
      }),
    ).resolves.toEqual(
      expect.objectContaining({ practiceStaffId: 'staff-1', updated: true }),
    );
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(3);
  });

  it('does not disclose a relationship outside Doctor ownership', async () => {
    prisma.practiceStaff.findFirst.mockResolvedValue(null);
    await expect(
      service.getRemovalImpact('doctor-1', 'staff-other'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.appointment.count).not.toHaveBeenCalled();
  });

  it('requires the Doctor password before any relationship removal effects', async () => {
    prisma.practiceStaff.findFirst.mockResolvedValue({
      id: 'staff-1',
      practiceLocationId: 'clinic-1',
      practiceLocation: { currentRegularPracticeStaffId: 'staff-1' },
    });
    prisma.user.findUnique.mockResolvedValue({
      id: 'doctor-1',
      role: 'DOCTOR',
      accountStatus: 'ACTIVE',
      administrativeRestrictionStatus: 'NONE',
      passwordHash: 'doctor-hash',
    });
    passwords.verify.mockResolvedValue(false);

    await expect(
      service.disconnectRelationship('doctor-1', 'staff-1', 'wrong-password'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.practiceLocation.update).not.toHaveBeenCalled();
    expect(prisma.practiceStaff.update).not.toHaveBeenCalled();
  });

  it('disconnects only after the Doctor password succeeds', async () => {
    prisma.practiceStaff.findFirst.mockResolvedValue({
      id: 'staff-1',
      practiceLocationId: 'clinic-1',
      practiceLocation: { currentRegularPracticeStaffId: null },
    });
    prisma.user.findUnique.mockResolvedValue({
      id: 'doctor-1',
      role: 'DOCTOR',
      accountStatus: 'ACTIVE',
      administrativeRestrictionStatus: 'NONE',
      passwordHash: 'doctor-hash',
    });
    passwords.verify.mockResolvedValue(true);
    prisma.$queryRaw.mockResolvedValue([]);
    prisma.substituteSecretaryCoverage.findMany.mockResolvedValue([]);

    await service.disconnectRelationship(
      'doctor-1',
      'staff-1',
      'correct-password',
    );

    expect(passwords.verify).toHaveBeenCalledWith(
      'correct-password',
      'doctor-hash',
    );
    expect(prisma.practiceStaff.update).toHaveBeenCalledTimes(1);
  });
});
