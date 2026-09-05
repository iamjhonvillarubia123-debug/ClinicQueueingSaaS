import { ConfigService } from '@nestjs/config';
import { ProtectedAccountPayloadService } from '../auth/security/protected-account-payload.service';
import { PasswordSecurityService } from '../auth/security/password-security.service';
import { PrismaService } from '../prisma/prisma.service';
import { SecretaryInvitationService } from './secretary-invitation.service';

describe('SecretaryInvitationService relationship isolation', () => {
  const tx = {
    secretaryInvitation: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    notificationOutbox: { update: jest.fn() },
    user: { findUnique: jest.fn() },
    practiceStaff: { create: jest.fn(), update: jest.fn() },
    practiceLocation: { update: jest.fn() },
    practiceStaffAuthorityBundle: { updateMany: jest.fn() },
    practiceStaffCapability: { updateMany: jest.fn(), create: jest.fn() },
    clinicDay: { findMany: jest.fn() },
    clinicDayOperatingStaffAudit: { create: jest.fn() },
    substituteSecretaryCoverageDate: {
      findFirst: jest.fn(),
      create: jest.fn(),
    },
    substituteSecretaryCoverage: { create: jest.fn() },
    $queryRaw: jest.fn(),
    $executeRaw: jest.fn(),
  };

  const prisma = {
    $transaction: jest.fn((callback: (transaction: typeof tx) => unknown) =>
      callback(tx),
    ),
  };

  const service = new SecretaryInvitationService(
    prisma as unknown as PrismaService,
    { get: jest.fn(() => 'https://clinic.example') } as unknown as ConfigService,
    { encrypt: jest.fn() } as unknown as ProtectedAccountPayloadService,
    { verify: jest.fn() } as unknown as PasswordSecurityService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    tx.secretaryInvitation.findUnique.mockResolvedValue({
      id: 'invite-1',
      status: 'PENDING',
      tokenHash: 'stored-hash',
      activeInvitationKey: 'active-key',
      expiresAt: new Date(Date.now() + 60_000),
      practiceLocationId: 'clinic-target',
      invitedByUserId: 'doctor-1',
      normalizedEmail: 'jane@example.test',
      requestedAssignmentType: 'CLINIC_SECRETARY',
      requestedAuthorityBundles: ['QUEUE_AND_CLINIC_DAY_OPERATIONS'],
      requestedCancelClinicDay: false,
      requestedCoverageMode: null,
      requestedFromServiceDate: null,
      requestedToServiceDate: null,
      expectedCurrentPracticeStaffId: null,
      notificationOutbox: null,
    });
    tx.user.findUnique.mockResolvedValue({
      id: 'secretary-1',
      email: 'jane@example.test',
      role: 'SECRETARY',
      accountStatus: 'ACTIVE',
      administrativeRestrictionStatus: 'NONE',
      emailVerifiedAt: new Date(),
    });
    tx.practiceStaff.update.mockResolvedValue({ id: 'staff-target' });
    tx.practiceStaff.create.mockResolvedValue({ id: 'staff-target' });
    tx.practiceLocation.update.mockResolvedValue({ id: 'clinic-target' });
    tx.secretaryInvitation.update.mockResolvedValue({ id: 'invite-1' });
    tx.practiceStaffAuthorityBundle.updateMany.mockResolvedValue({ count: 0 });
    tx.practiceStaffCapability.updateMany.mockResolvedValue({ count: 0 });
    tx.$executeRaw.mockResolvedValue(1);
  });

  function arrangeAcceptance(existingStaff: boolean) {
    tx.$queryRaw
      .mockResolvedValueOnce([{ id: 'invite-1' }])
      .mockResolvedValueOnce([
        {
          id: 'clinic-target',
          doctorUserId: 'doctor-1',
          currentRegularPracticeStaffId: null,
        },
      ])
      .mockResolvedValueOnce(
        existingStaff
          ? [{ id: 'staff-target', staffRole: 'SECRETARY', isActive: false }]
          : [],
      );
  }

  it('reactivates only the intended clinic PracticeStaff relationship', async () => {
    arrangeAcceptance(true);

    await expect(
      service.acceptPendingById('secretary-1', 'invite-1'),
    ).resolves.toEqual(
      expect.objectContaining({
        accepted: true,
        practiceStaffId: 'staff-target',
      }),
    );

    expect(tx.practiceStaff.update).toHaveBeenCalledTimes(1);
    expect(tx.practiceStaff.update).toHaveBeenCalledWith({
      where: { id: 'staff-target' },
      data: expect.objectContaining({
        isActive: true,
        deactivatedAt: null,
        disconnectedAt: null,
      }) as unknown,
    });
    expect(tx.practiceStaff.create).not.toHaveBeenCalled();
    expect(tx.practiceLocation.update).toHaveBeenCalledWith({
      where: { id: 'clinic-target' },
      data: { currentRegularPracticeStaffId: 'staff-target' },
    });

    const updatedStaffIds = tx.practiceStaff.update.mock.calls.map(
      ([argument]) => argument.where.id,
    );
    expect(updatedStaffIds).toEqual(['staff-target']);
    expect(updatedStaffIds).not.toContain('staff-other-clinic');
  });

  it('creates only the intended PracticeStaff relationship and never creates a User', async () => {
    arrangeAcceptance(false);

    await expect(
      service.acceptPendingById('secretary-1', 'invite-1'),
    ).resolves.toEqual(
      expect.objectContaining({
        accepted: true,
        practiceStaffId: 'staff-target',
      }),
    );

    expect(tx.practiceStaff.create).toHaveBeenCalledTimes(1);
    expect(tx.practiceStaff.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'secretary-1',
        practiceLocationId: 'clinic-target',
        staffRole: 'SECRETARY',
        isActive: true,
      }) as unknown,
      select: { id: true },
    });
    expect(tx).not.toHaveProperty('user.create');
    expect(tx.practiceStaff.update).not.toHaveBeenCalled();
  });
});
