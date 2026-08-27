import { ConflictException, ForbiddenException } from '@nestjs/common';
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
    $executeRaw: jest.fn(),
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
    transactionMock.practiceLocation.findFirst.mockResolvedValue(null);
    transactionMock.doctorServiceTemplate.findMany.mockResolvedValue([]);
    transactionMock.doctorBookingQuestionTemplate.findMany.mockResolvedValue(
      [],
    );
    transactionMock.$executeRaw.mockResolvedValue(1);
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
          shortCode: null,
          addressLine1: null,
          clinicEmail: null,
          clinicDescription: null,
          countryCode: null,
          timeZone: null,
          services: { create: [] },
          bookingQuestions: { create: [] },
        }) as unknown,
      }),
    );
    expect(transactionMock.$executeRaw).not.toHaveBeenCalled();
  });

  it('copies current Doctor-wide defaults into a new location and stamps BookingQuestion provenance', async () => {
    prismaServiceMock.doctorProfile.findUnique.mockResolvedValue({
      id: 'doctor-profile-1',
    });
    transactionMock.doctorServiceTemplate.findMany.mockResolvedValue([
      {
        id: 'service-template-1',
        name: 'Consultation',
        description: 'General consultation',
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
                description: 'General consultation',
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
    expect(transactionMock.$executeRaw).toHaveBeenCalledTimes(1);
  });

  it('normalizes the complete Basic Info draft at creation', async () => {
    prismaServiceMock.doctorProfile.findUnique.mockResolvedValue({
      id: 'doctor-profile-1',
    });
    transactionMock.practiceLocation.create.mockResolvedValue({
      id: 'location-1',
    });

    await service.create('doctor-user-1', {
      name: '  Sample Clinic  ',
      shortCode: '  north  ',
      addressLine1: '  Main Street  ',
      addressLine2: '   ',
      cityMunicipality: '  Manila  ',
      contactNumber: '  09170000000  ',
      clinicEmail: '  CLINIC@EXAMPLE.COM  ',
      clinicDescription: '  Clinic description  ',
      countryCode: ' ph ',
      timeZone: '  Asia/Manila  ',
    });

    expect(transactionMock.practiceLocation.findFirst).toHaveBeenNthCalledWith(
      1,
      {
        where: {
          doctorProfileId: 'doctor-profile-1',
          lifecycleStatus: PracticeLocationLifecycleStatus.ACTIVE,
          name: { equals: 'Sample Clinic', mode: 'insensitive' },
          addressLine1: { equals: 'Main Street', mode: 'insensitive' },
        },
        select: { id: true },
      },
    );
    expect(transactionMock.practiceLocation.findFirst).toHaveBeenNthCalledWith(
      2,
      {
        where: {
          doctorProfileId: 'doctor-profile-1',
          lifecycleStatus: {
            not: PracticeLocationLifecycleStatus.PERMANENTLY_DELETED,
          },
          shortCode: { equals: 'NORTH', mode: 'insensitive' },
        },
        select: { id: true },
      },
    );
    expect(transactionMock.practiceLocation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          name: 'Sample Clinic',
          shortCode: 'NORTH',
          addressLine1: 'Main Street',
          addressLine2: null,
          cityMunicipality: 'Manila',
          contactNumber: '09170000000',
          clinicEmail: 'clinic@example.com',
          clinicDescription: 'Clinic description',
          countryCode: 'PH',
          timeZone: 'Asia/Manila',
        }) as unknown,
      }),
    );
  });

  it('rejects a duplicate short code before creating another clinic', async () => {
    prismaServiceMock.doctorProfile.findUnique.mockResolvedValue({
      id: 'doctor-profile-1',
    });
    transactionMock.practiceLocation.findFirst.mockResolvedValueOnce({
      id: 'existing-location',
    });

    await expect(
      service.create('doctor-user-1', { shortCode: 'north' }),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(transactionMock.practiceLocation.create).not.toHaveBeenCalled();
  });

  it('rejects PracticeLocation creation when the authenticated User is not a Doctor owner', async () => {
    prismaServiceMock.doctorProfile.findUnique.mockResolvedValue(null);

    await expect(service.create('secretary-user-1', {})).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(prismaServiceMock.$transaction).not.toHaveBeenCalled();
  });
});
