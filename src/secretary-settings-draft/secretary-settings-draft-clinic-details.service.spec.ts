import { ForbiddenException } from '@nestjs/common';
import {
  PracticeLocationLifecycleStatus,
  SecretarySettingsDraftStatus,
} from '../../generated/prisma/client';
import { SecretarySettingsDraftClinicDetailsService } from './secretary-settings-draft-clinic-details.service';

describe('SecretarySettingsDraftClinicDetailsService', () => {
  const prismaMock = {
    $transaction: jest.fn(),
    $queryRaw: jest.fn(),
    secretarySettingsDraftClinicDetails: { upsert: jest.fn() },
  };
  let service: SecretarySettingsDraftClinicDetailsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new SecretarySettingsDraftClinicDetailsService(prismaMock as never);
    prismaMock.$transaction.mockImplementation(
      (callback: (transaction: typeof prismaMock) => unknown) => callback(prismaMock),
    );
    prismaMock.$queryRaw.mockResolvedValue([
      {
        id: 'draft-1',
        practiceLocationId: 'location-1',
        status: SecretarySettingsDraftStatus.DRAFT,
        lifecycleStatus: PracticeLocationLifecycleStatus.ACTIVE,
        currentRegularPracticeStaffId: 'staff-1',
        currentSecretaryUserId: 'secretary-1',
        currentAssignmentActive: true,
      },
    ]);
    prismaMock.secretarySettingsDraftClinicDetails.upsert.mockResolvedValue({ id: 'proposal-1' });
  });

  it('saves clinic identity/contact details only into the settings proposal', async () => {
    await expect(
      service.upsert('secretary-1', 'draft-1', {
        name: ' North Clinic ',
        addressLine1: ' 1 Main Street ',
        addressLine2: '',
        cityMunicipality: ' Manila ',
        province: ' Metro Manila ',
        postalCode: '1000',
        contactNumber: '09170000000',
        countryCode: 'ph',
        timeZone: 'Asia/Manila',
      }),
    ).resolves.toEqual({ saved: true, draftId: 'draft-1', proposalId: 'proposal-1' });

    expect(prismaMock.secretarySettingsDraftClinicDetails.upsert).toHaveBeenCalledWith({
      where: { secretarySettingsDraftId: 'draft-1' },
      update: expect.objectContaining({
        proposedName: 'North Clinic',
        proposedAddressLine1: '1 Main Street',
        proposedAddressLine2: null,
        proposedCountryCode: 'PH',
        proposedTimeZone: 'Asia/Manila',
      }),
      create: expect.objectContaining({ secretarySettingsDraftId: 'draft-1' }),
    });
  });

  it('denies a Secretary who is no longer the current regular Secretary', async () => {
    prismaMock.$queryRaw.mockResolvedValue([
      {
        id: 'draft-1',
        practiceLocationId: 'location-1',
        status: SecretarySettingsDraftStatus.DRAFT,
        lifecycleStatus: PracticeLocationLifecycleStatus.ACTIVE,
        currentRegularPracticeStaffId: 'staff-2',
        currentSecretaryUserId: 'secretary-2',
        currentAssignmentActive: true,
      },
    ]);

    await expect(
      service.upsert('secretary-1', 'draft-1', {
        name: 'North Clinic',
        addressLine1: '1 Main Street',
        cityMunicipality: 'Manila',
        province: 'Metro Manila',
        contactNumber: '09170000000',
        countryCode: 'PH',
        timeZone: 'Asia/Manila',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prismaMock.secretarySettingsDraftClinicDetails.upsert).not.toHaveBeenCalled();
  });
});
