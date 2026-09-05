import { Test, TestingModule } from '@nestjs/testing';
import {
  AdministrativeRestrictionStatus,
  UserAccountStatus,
  UserRole,
} from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { DoctorProfileOnboardingService } from './doctor-profile-onboarding.service';

type DoctorProfileCreateArgs = {
  data: Record<string, unknown>;
  select: Record<string, unknown>;
};

describe('DoctorProfileOnboardingService', () => {
  let service: DoctorProfileOnboardingService;

  const profile = {
    id: 'profile-1',
    middleName: null,
    suffix: null,
    professionalTitle: 'Doctor',
    specialization: 'Family Medicine',
    licenseNumber: 'LIC-123',
    profileDescription: null,
    profilePhotoUrl: null,
    publicIdentifier: 'doctor-public-id',
    publicSlug: null,
    isProfilePublic: false,
  };

  const createProfileMock = jest.fn<
    Promise<typeof profile>,
    [DoctorProfileCreateArgs]
  >();

  const transaction = {
    $queryRaw: jest.fn<Promise<unknown[]>, [unknown]>(),
    user: { update: jest.fn() },
    doctorProfile: {
      findUnique: jest.fn(),
      create: createProfileMock,
    },
    doctorAccountSettings: { create: jest.fn() },
  };

  const prismaServiceMock = {
    user: { findUnique: jest.fn() },
    $transaction: jest.fn(),
  };

  const eligibleUser = {
    id: 'doctor-user',
    role: UserRole.DOCTOR,
    accountStatus: UserAccountStatus.ACTIVE,
    administrativeRestrictionStatus: AdministrativeRestrictionStatus.NONE,
    emailVerifiedAt: new Date('2026-09-05T00:00:00.000Z'),
    firstName: 'Jane',
    middleName: null,
    lastName: 'Doe',
    doctorProfile: null,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DoctorProfileOnboardingService,
        { provide: PrismaService, useValue: prismaServiceMock },
      ],
    }).compile();

    service = module.get(DoctorProfileOnboardingService);
    jest.clearAllMocks();
    prismaServiceMock.user.findUnique.mockResolvedValue(eligibleUser);
    prismaServiceMock.$transaction.mockImplementation(
      (callback: (tx: typeof transaction) => Promise<unknown>) =>
        callback(transaction),
    );
    transaction.$queryRaw.mockResolvedValue([
      {
        id: eligibleUser.id,
        role: eligibleUser.role,
        accountStatus: eligibleUser.accountStatus,
        administrativeRestrictionStatus:
          eligibleUser.administrativeRestrictionStatus,
        emailVerifiedAt: eligibleUser.emailVerifiedAt,
      },
    ]);
    transaction.doctorProfile.findUnique.mockResolvedValue(null);
    transaction.user.update.mockResolvedValue({ id: eligibleUser.id });
    createProfileMock.mockResolvedValue(profile);
    transaction.doctorAccountSettings.create.mockResolvedValue({
      id: 'settings-1',
    });
  });

  it('reports an eligible Doctor without a DoctorProfile as onboarding-incomplete', async () => {
    const result = await service.getProfileState('doctor-user');

    expect(result.onboardingComplete).toBe(false);
    expect(result.user).toEqual({
      firstName: 'Jane',
      middleName: null,
      lastName: 'Doe',
    });
    expect(result.profile).toBeNull();
  });

  it('creates DoctorProfile and DoctorAccountSettings atomically for the verified Doctor', async () => {
    const result = await service.completeOnboarding('doctor-user', {
      firstName: ' Jane ',
      middleName: ' Q ',
      lastName: ' Doe ',
      suffix: '',
      professionalTitle: ' Doctor ',
      specialization: ' Family Medicine ',
      licenseNumber: ' LIC-123 ',
      profileDescription: ' Community practice ',
    });

    expect(transaction.user.update).toHaveBeenCalledWith({
      where: { id: 'doctor-user' },
      data: { firstName: 'Jane', middleName: 'Q', lastName: 'Doe' },
    });

    const createProfileCall = createProfileMock.mock.calls[0]?.[0];
    expect(createProfileCall?.data).toEqual({
      userId: 'doctor-user',
      middleName: 'Q',
      suffix: null,
      professionalTitle: 'Doctor',
      specialization: 'Family Medicine',
      licenseNumber: 'LIC-123',
      profileDescription: 'Community practice',
      isProfilePublic: false,
    });
    expect(createProfileCall?.select.id).toBe(true);

    expect(transaction.doctorAccountSettings.create).toHaveBeenCalledWith({
      data: { doctorProfileId: 'profile-1' },
    });
    expect(result).toEqual({
      onboardingComplete: true,
      user: { firstName: 'Jane', middleName: 'Q', lastName: 'Doe' },
      profile,
    });
  });

  it('rejects Secretary accounts and unverified Doctor accounts', async () => {
    prismaServiceMock.user.findUnique.mockResolvedValueOnce({
      ...eligibleUser,
      role: UserRole.SECRETARY,
    });

    await expect(service.getProfileState('secretary-user')).rejects.toThrow(
      'Only an active verified Doctor may complete Doctor onboarding.',
    );

    prismaServiceMock.user.findUnique.mockResolvedValueOnce({
      ...eligibleUser,
      emailVerifiedAt: null,
    });

    await expect(
      service.completeOnboarding('doctor-user', {
        firstName: 'Jane',
        lastName: 'Doe',
        professionalTitle: 'Doctor',
        specialization: 'Family Medicine',
        licenseNumber: 'LIC-123',
      }),
    ).rejects.toThrow(
      'Only an active verified Doctor may complete Doctor onboarding.',
    );
  });

  it('does not allow the onboarding command to overwrite an existing DoctorProfile', async () => {
    prismaServiceMock.user.findUnique.mockResolvedValueOnce({
      ...eligibleUser,
      doctorProfile: { id: 'existing-profile' },
    });

    await expect(
      service.completeOnboarding('doctor-user', {
        firstName: 'Jane',
        lastName: 'Doe',
        professionalTitle: 'Doctor',
        specialization: 'Family Medicine',
        licenseNumber: 'LIC-123',
      }),
    ).rejects.toThrow('Doctor onboarding is already complete.');

    expect(prismaServiceMock.$transaction).not.toHaveBeenCalled();
  });
});
