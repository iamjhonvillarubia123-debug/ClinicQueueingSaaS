import { ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import {
  PracticeStaffRole,
  UserAccountStatus,
  UserRole,
} from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PracticeStaffService } from './practice-staff.service';

describe('PracticeStaffService', () => {
  let service: PracticeStaffService;

  const prismaServiceMock = {
    practiceStaff: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
    },
    doctorProfile: {
      findUnique: jest.fn(),
    },
    practiceLocation: {
      findFirst: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PracticeStaffService,
        {
          provide: PrismaService,
          useValue: prismaServiceMock,
        },
      ],
    }).compile();

    service = module.get<PracticeStaffService>(PracticeStaffService);

    jest.clearAllMocks();
  });

  it('assigns only an ACTIVE Secretary to an owned PracticeLocation', async () => {
    prismaServiceMock.doctorProfile.findUnique.mockResolvedValue({
      id: 'doctor-profile-1',
      userId: 'doctor-1',
    });
    prismaServiceMock.practiceLocation.findFirst.mockResolvedValue({
      id: 'location-1',
      doctorProfileId: 'doctor-profile-1',
    });
    prismaServiceMock.user.findUnique.mockResolvedValue({
      id: 'secretary-1',
      role: UserRole.SECRETARY,
      accountStatus: UserAccountStatus.ACTIVE,
    });
    prismaServiceMock.practiceStaff.findFirst.mockResolvedValue(null);
    prismaServiceMock.practiceStaff.create.mockResolvedValue({
      id: 'staff-1',
      userId: 'secretary-1',
      practiceLocationId: 'location-1',
      staffRole: PracticeStaffRole.SECRETARY,
      isActive: true,
    });

    await expect(
      service.assign('doctor-1', {
        practiceLocationId: 'location-1',
        userId: 'secretary-1',
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        userId: 'secretary-1',
        practiceLocationId: 'location-1',
      }),
    );

    expect(prismaServiceMock.practiceStaff.create).toHaveBeenCalledTimes(1);
  });

  it.each([
    UserAccountStatus.VOLUNTARILY_DISABLED,
    UserAccountStatus.PERMANENTLY_CLOSED,
  ])(
    'rejects assignment when the Secretary account is %s',
    async (accountStatus) => {
      prismaServiceMock.doctorProfile.findUnique.mockResolvedValue({
        id: 'doctor-profile-1',
        userId: 'doctor-1',
      });
      prismaServiceMock.practiceLocation.findFirst.mockResolvedValue({
        id: 'location-1',
        doctorProfileId: 'doctor-profile-1',
      });
      prismaServiceMock.user.findUnique.mockResolvedValue({
        id: 'secretary-1',
        role: UserRole.SECRETARY,
        accountStatus,
      });

      await expect(
        service.assign('doctor-1', {
          practiceLocationId: 'location-1',
          userId: 'secretary-1',
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(prismaServiceMock.practiceStaff.findFirst).not.toHaveBeenCalled();
      expect(prismaServiceMock.practiceStaff.create).not.toHaveBeenCalled();
    },
  );

  it('rejects a non-Secretary target even when the account is ACTIVE', async () => {
    prismaServiceMock.doctorProfile.findUnique.mockResolvedValue({
      id: 'doctor-profile-1',
      userId: 'doctor-1',
    });
    prismaServiceMock.practiceLocation.findFirst.mockResolvedValue({
      id: 'location-1',
      doctorProfileId: 'doctor-profile-1',
    });
    prismaServiceMock.user.findUnique.mockResolvedValue({
      id: 'doctor-2',
      role: UserRole.DOCTOR,
      accountStatus: UserAccountStatus.ACTIVE,
    });

    await expect(
      service.assign('doctor-1', {
        practiceLocationId: 'location-1',
        userId: 'doctor-2',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(prismaServiceMock.practiceStaff.create).not.toHaveBeenCalled();
  });
});
