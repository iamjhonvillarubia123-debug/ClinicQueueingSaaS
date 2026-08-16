import { ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import {
  BookingQuestionType,
  PracticeLocationLifecycleStatus,
  ServiceAvailabilityStatus,
} from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PracticeLocationService } from './practice-location.service';

describe('PracticeLocationService', () => {
  let service: PracticeLocationService;

  const transactionMock = {
    practiceLocation: {
      findFirst: jest.fn(),
      create: jest.fn(),
    },
    doctorServiceTemplate: {
      findMany: jest.fn(),
    },
    doctorBookingQuestionTemplate: {
      findMany: jest.fn(),
    },
  };

  const prismaServiceMock = {
    doctorProfile: {
      findUnique: jest.fn(),
    },
    practiceLocation: {
      findMany: jest.fn(),
    },
    $transaction: jest.fn(
      (callback: (transaction: typeof transactionMock) => unknown) =>
        callback(transactionMock),
    ),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PracticeLocationService,
        { provide: PrismaService, useValue: prismaServiceMock },
      ],
    }).compile();

    service = module.get<PracticeLocationService>(PracticeLocationService);
    jest.clearAllMocks();
    transactionMock.doctorServiceTemplate.findMany.mockResolvedValue([]);
    transactionMock.doctorBookingQuestionTemplate.findMany.mockResolvedValue(
      [],
    );
  });

  it('creates an intentionally blank PracticeLocation as DRAFT', async () => {
    prismaServiceMock.doctorProfile.findUnique.mockResolvedValue({
      id: 'doctor-profile-1',
    });
    transactionMock.practiceLocation.create.mockResolvedValue({
      id: 'location-1',
      lifecycleStatus: PracticeLocationLifecycleStatus.DRAFT,
    });

    await service.create('doctor-user-1', {});

    expect(transactionMock.practiceLocation.findFirst).not.toHaveBeenCalled();
    expect(transactionMock.practiceLocation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          doctorProfileId: 'doctor-profile-1',
          lifecycleStatus: PracticeLocationLifecycleStatus.DRAFT,
          name: null,
          addressLine1: null,
          services: { create: [] },
          bookingQuestions: { create: [] },
        }) as unknown,
      }),
    );
  });

  it('copies current Doctor-wide defaults into a new location without synchronization relations', async () => {
    prismaServiceMock.doctorProfile.findUnique.mockResolvedValue({
      id: 'doctor-profile-1',
    });
    transactionMock.doctorServiceTemplate.findMany.mockResolvedValue([
      {
        id: 'service-template-1',
        name: 'Consultation',
        durationMinutes: 30,
        status: ServiceAvailabilityStatus.ACTIVE,
      },
    ]);
    transactionMock.doctorBookingQuestionTemplate.findMany.mockResolvedValue([
      {
        id: 'question-template-1',
        questionText: 'Do you have allergies?',
        helpText: null,
        type: BookingQuestionType.BOOLEAN,
        isRequired: true,
        displayOrder: 0,
        isActive: true,
        estimatedMinutesAdjustment: 0,
        textMaximumLength: null,
        numberMinimum: null,
        numberMaximum: null,
        selectOptions: null,
      },
    ]);
    transactionMock.practiceLocation.create.mockResolvedValue({
      id: 'location-1',
    });

    await service.create('doctor-user-1', {});

    expect(transactionMock.practiceLocation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          services: {
            create: [
              expect.objectContaining({
                sourceDoctorServiceTemplateId: 'service-template-1',
                name: 'Consultation',
                durationMinutes: 30,
                status: ServiceAvailabilityStatus.ACTIVE,
              }),
            ],
          },
          bookingQuestions: {
            create: [
              expect.objectContaining({
                questionText: 'Do you have allergies?',
                type: BookingQuestionType.BOOLEAN,
                isRequired: true,
                displayOrder: 0,
                isActive: true,
              }),
            ],
          },
        }) as unknown,
      }),
    );
  });

  it('normalizes optional draft fields without requiring full configuration', async () => {
    prismaServiceMock.doctorProfile.findUnique.mockResolvedValue({
      id: 'doctor-profile-1',
    });
    transactionMock.practiceLocation.findFirst.mockResolvedValue(null);
    transactionMock.practiceLocation.create.mockResolvedValue({
      id: 'location-1',
    });

    await service.create('doctor-user-1', {
      name: '  Sample Clinic  ',
      addressLine1: '  Main Street  ',
      addressLine2: '   ',
      cityMunicipality: '  Manila  ',
    });

    expect(transactionMock.practiceLocation.findFirst).toHaveBeenCalledWith({
      where: {
        doctorProfileId: 'doctor-profile-1',
        lifecycleStatus: PracticeLocationLifecycleStatus.ACTIVE,
        name: { equals: 'Sample Clinic', mode: 'insensitive' },
        addressLine1: { equals: 'Main Street', mode: 'insensitive' },
      },
      select: { id: true },
    });
    expect(transactionMock.practiceLocation.create).toHaveBeenCalledWith(
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
    expect(prismaServiceMock.$transaction).not.toHaveBeenCalled();
  });
});
