import { ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PracticeLocationLifecycleStatus } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PracticeLocationService } from './practice-location.service';

describe('PracticeLocationService', () => {
  let service: PracticeLocationService;

  const prismaServiceMock = {
    doctorProfile: {
      findUnique: jest.fn(),
    },
    practiceLocation: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PracticeLocationService,
        {
          provide: PrismaService,
          useValue: prismaServiceMock,
        },
      ],
    }).compile();

    service = module.get<PracticeLocationService>(PracticeLocationService);

    jest.clearAllMocks();
  });

  it('creates an intentionally blank PracticeLocation as DRAFT', async () => {
    prismaServiceMock.doctorProfile.findUnique.mockResolvedValue({
      id: 'doctor-profile-1',
    });
    prismaServiceMock.practiceLocation.create.mockResolvedValue({
      id: 'location-1',
      lifecycleStatus: PracticeLocationLifecycleStatus.DRAFT,
    });

    await service.create('doctor-user-1', {});

    expect(prismaServiceMock.practiceLocation.findFirst).not.toHaveBeenCalled();
    expect(prismaServiceMock.practiceLocation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          doctorProfileId: 'doctor-profile-1',
          lifecycleStatus: PracticeLocationLifecycleStatus.DRAFT,
          name: null,
          addressLine1: null,
          addressLine2: null,
          cityMunicipality: null,
          province: null,
          postalCode: null,
          contactNumber: null,
        }) as unknown,
      }),
    );
  });

  it('normalizes optional draft fields without requiring full configuration', async () => {
    prismaServiceMock.doctorProfile.findUnique.mockResolvedValue({
      id: 'doctor-profile-1',
    });
    prismaServiceMock.practiceLocation.findFirst.mockResolvedValue(null);
    prismaServiceMock.practiceLocation.create.mockResolvedValue({
      id: 'location-1',
      lifecycleStatus: PracticeLocationLifecycleStatus.DRAFT,
    });

    await service.create('doctor-user-1', {
      name: '  Sample Clinic  ',
      addressLine1: '  Main Street  ',
      addressLine2: '   ',
      cityMunicipality: '  Manila  ',
    });

    expect(prismaServiceMock.practiceLocation.findFirst).toHaveBeenCalledWith({
      where: {
        doctorProfileId: 'doctor-profile-1',
        lifecycleStatus: PracticeLocationLifecycleStatus.ACTIVE,
        name: { equals: 'Sample Clinic', mode: 'insensitive' },
        addressLine1: { equals: 'Main Street', mode: 'insensitive' },
      },
    });
    expect(prismaServiceMock.practiceLocation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          name: 'Sample Clinic',
          addressLine1: 'Main Street',
          addressLine2: null,
          cityMunicipality: 'Manila',
        }) as unknown,
      }),
    );
  });

  it('rejects PracticeLocation creation when the authenticated User is not a Doctor owner', async () => {
    prismaServiceMock.doctorProfile.findUnique.mockResolvedValue(null);

    await expect(service.create('secretary-user-1', {})).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(prismaServiceMock.practiceLocation.create).not.toHaveBeenCalled();
  });
});
