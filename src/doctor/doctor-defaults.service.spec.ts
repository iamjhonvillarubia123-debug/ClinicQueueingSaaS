import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import {
  BookingQuestionType,
  ServiceAvailabilityStatus,
} from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { DoctorDefaultsService } from './doctor-defaults.service';

describe('DoctorDefaultsService', () => {
  let service: DoctorDefaultsService;

  const prismaMock = {
    $queryRaw: jest.fn().mockResolvedValue([{ id: 'owner' }]),
    $transaction: jest.fn(),
    doctorProfile: { findUnique: jest.fn() },
    doctorServiceTemplate: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      deleteMany: jest.fn(),
    },
    doctorBookingQuestionTemplate: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      deleteMany: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DoctorDefaultsService,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();
    service = module.get(DoctorDefaultsService);
    jest.clearAllMocks();
    prismaMock.$transaction.mockImplementation(
      (operation: (tx: typeof prismaMock) => unknown) => operation(prismaMock),
    );
  });

  it('rejects non-Doctor users from Doctor-wide defaults', async () => {
    prismaMock.doctorProfile.findUnique.mockResolvedValue(null);
    await expect(service.list('secretary-user')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('removes only the owning Doctor template, not clinic copies', async () => {
    prismaMock.doctorProfile.findUnique.mockResolvedValue({ id: 'doctor-1' });
    prismaMock.doctorServiceTemplate.deleteMany.mockResolvedValue({ count: 1 });
    await expect(
      service.removeTemplate('doctor-user', 'services', 'template'),
    ).resolves.toEqual({ removed: true, clinicCopiesUnchanged: true });
    expect(prismaMock.doctorServiceTemplate.deleteMany).toHaveBeenCalledWith({
      where: { id: 'template', doctorProfileId: 'doctor-1' },
    });
  });

  it('reorders with temporary unique positions and rejects incomplete or foreign selections', async () => {
    prismaMock.doctorProfile.findUnique.mockResolvedValue({ id: 'doctor-1' });
    prismaMock.doctorBookingQuestionTemplate.findMany.mockResolvedValue([
      { id: 'a', displayOrder: 0 },
      { id: 'b', displayOrder: 1 },
    ]);
    await expect(
      service.reorderQuestions('doctor-user', ['foreign', 'b']),
    ).rejects.toThrow('list changed');
    expect(
      prismaMock.doctorBookingQuestionTemplate.update,
    ).not.toHaveBeenCalled();
    await service.reorderQuestions('doctor-user', ['b', 'a']);
    expect(
      prismaMock.doctorBookingQuestionTemplate.update,
    ).toHaveBeenNthCalledWith(3, {
      where: { id: 'b' },
      data: { displayOrder: 0 },
    });
    expect(
      prismaMock.doctorBookingQuestionTemplate.update,
    ).toHaveBeenNthCalledWith(4, {
      where: { id: 'a' },
      data: { displayOrder: 1 },
    });
  });

  it('creates a bounded Service template for the owning Doctor', async () => {
    prismaMock.doctorProfile.findUnique.mockResolvedValue({ id: 'doctor-1' });
    prismaMock.doctorServiceTemplate.create.mockResolvedValue({
      id: 'service-1',
    });

    await service.createServiceTemplate('doctor-user', {
      name: '  Consultation  ',
      durationMinutes: 30,
      status: ServiceAvailabilityStatus.ACTIVE,
    });

    expect(prismaMock.doctorServiceTemplate.create).toHaveBeenCalledWith({
      data: {
        doctorProfileId: 'doctor-1',
        name: 'Consultation',
        durationMinutes: 30,
        status: ServiceAvailabilityStatus.ACTIVE,
      },
    });
  });

  it('rejects Service duration above the approved 24-hour bound', async () => {
    prismaMock.doctorProfile.findUnique.mockResolvedValue({ id: 'doctor-1' });
    await expect(
      service.createServiceTemplate('doctor-user', {
        name: 'Consultation',
        durationMinutes: 1441,
        status: ServiceAvailabilityStatus.ACTIVE,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('blocks a sixth active Doctor-wide BookingQuestion', async () => {
    prismaMock.doctorProfile.findUnique.mockResolvedValue({ id: 'doctor-1' });
    prismaMock.doctorBookingQuestionTemplate.findFirst.mockResolvedValue(null);
    prismaMock.doctorBookingQuestionTemplate.count.mockResolvedValue(5);

    await expect(
      service.createBookingQuestionTemplate('doctor-user', {
        questionText: 'Question six?',
        type: BookingQuestionType.BOOLEAN,
        isRequired: false,
        displayOrder: 5,
        isActive: true,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('accepts a valid SINGLE_SELECT template and forces zero duration adjustment', async () => {
    prismaMock.doctorProfile.findUnique.mockResolvedValue({ id: 'doctor-1' });
    prismaMock.doctorBookingQuestionTemplate.findFirst.mockResolvedValue(null);
    prismaMock.doctorBookingQuestionTemplate.count.mockResolvedValue(0);
    prismaMock.doctorBookingQuestionTemplate.create.mockResolvedValue({
      id: 'question-1',
    });

    await service.createBookingQuestionTemplate('doctor-user', {
      questionText: 'Visit type?',
      type: BookingQuestionType.SINGLE_SELECT,
      isRequired: true,
      displayOrder: 0,
      isActive: true,
      selectOptions: [
        { value: ' new ', label: ' New patient ' },
        { value: 'return', label: 'Returning patient' },
      ],
    });

    expect(
      prismaMock.doctorBookingQuestionTemplate.create,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          doctorProfileId: 'doctor-1',
          estimatedMinutesAdjustment: 0,
          selectOptions: [
            { value: 'new', label: 'New patient' },
            { value: 'return', label: 'Returning patient' },
          ],
        }) as unknown,
      }),
    );
  });
});
