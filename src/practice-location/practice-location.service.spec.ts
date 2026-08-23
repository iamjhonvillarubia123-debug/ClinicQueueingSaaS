import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import {
  BookingQuestionType,
  PracticeLocationLifecycleStatus,
  ServiceAvailabilityStatus,
  Weekday,
} from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RecurringScheduleConflictService } from '../schedule/recurring-schedule-conflict.service';
import { ScheduleTimeService } from '../schedule/schedule-time.service';
import { PracticeLocationService } from './practice-location.service';

describe('PracticeLocationService', () => {
  let service: PracticeLocationService;

  const transactionMock = {
    practiceLocation: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    practiceSchedule: {
      deleteMany: jest.fn(),
      createMany: jest.fn(),
    },
    doctorServiceTemplate: { findMany: jest.fn() },
    doctorBookingQuestionTemplate: { findMany: jest.fn() },
    $executeRaw: jest.fn(),
  };

  const prismaServiceMock = {
    doctorProfile: { findUnique: jest.fn() },
    practiceLocation: { findMany: jest.fn(), findFirst: jest.fn() },
    $transaction: jest.fn(
      (callback: (transaction: typeof transactionMock) => unknown) =>
        callback(transactionMock),
    ),
  };
  const scheduleTimeMock = { assertValidTimeZone: jest.fn() };
  const recurringConflictMock = { assertNoConflictForLocation: jest.fn() };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PracticeLocationService,
        { provide: PrismaService, useValue: prismaServiceMock },
        { provide: ScheduleTimeService, useValue: scheduleTimeMock },
        {
          provide: RecurringScheduleConflictService,
          useValue: recurringConflictMock,
        },
      ],
    }).compile();
    service = module.get<PracticeLocationService>(PracticeLocationService);
    jest.clearAllMocks();
    transactionMock.doctorServiceTemplate.findMany.mockResolvedValue([]);
    transactionMock.doctorBookingQuestionTemplate.findMany.mockResolvedValue(
      [],
    );
    transactionMock.$executeRaw.mockResolvedValue(1);
    transactionMock.practiceSchedule.deleteMany.mockResolvedValue({ count: 0 });
    transactionMock.practiceSchedule.createMany.mockResolvedValue({ count: 7 });
    recurringConflictMock.assertNoConflictForLocation.mockResolvedValue(
      undefined,
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

  it('copies current Doctor-wide defaults into a new location', async () => {
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
              }),
            ],
          },
          bookingQuestions: {
            create: [
              expect.objectContaining({
                questionText: 'Do you have allergies?',
                isRequired: true,
              }),
            ],
          },
        }) as unknown,
      }),
    );
    expect(transactionMock.$executeRaw).toHaveBeenCalledTimes(1);
  });

  it('saves one recurring interval per weekday for a draft location', async () => {
    prismaServiceMock.doctorProfile.findUnique.mockResolvedValue({
      id: 'doctor-profile-1',
    });
    transactionMock.practiceLocation.findFirst.mockResolvedValue({
      id: 'location-1',
      lifecycleStatus: PracticeLocationLifecycleStatus.DRAFT,
    });
    transactionMock.practiceLocation.findUnique.mockResolvedValue({
      id: 'location-1',
      lifecycleStatus: PracticeLocationLifecycleStatus.DRAFT,
      practiceSchedules: [],
    });

    const schedules = [
      Weekday.MONDAY,
      Weekday.TUESDAY,
      Weekday.WEDNESDAY,
      Weekday.THURSDAY,
      Weekday.FRIDAY,
      Weekday.SATURDAY,
      Weekday.SUNDAY,
    ].map((weekday) => ({
      weekday,
      isOpen: weekday === Weekday.MONDAY,
      opensAtLocal: weekday === Weekday.MONDAY ? '09:00' : null,
      closesAtLocal: weekday === Weekday.MONDAY ? '17:00' : null,
      maximumOperatingUntilLocal:
        weekday === Weekday.MONDAY ? '18:00' : null,
    }));

    await service.updateDraftConfiguration('doctor-user-1', 'location-1', {
      timeZone: 'Asia/Manila',
      countryCode: 'ph',
      schedules,
    });

    expect(scheduleTimeMock.assertValidTimeZone).toHaveBeenCalledWith(
      'Asia/Manila',
    );
    expect(transactionMock.practiceLocation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          countryCode: 'PH',
          timeZone: 'Asia/Manila',
        }) as unknown,
      }),
    );
    expect(transactionMock.practiceSchedule.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({ weekday: Weekday.MONDAY, isOpen: true }),
        ]) as unknown,
      }),
    );
    expect(
      recurringConflictMock.assertNoConflictForLocation,
    ).toHaveBeenCalled();
  });

  it('rejects an open recurring day whose closing time is not after opening', async () => {
    prismaServiceMock.doctorProfile.findUnique.mockResolvedValue({
      id: 'doctor-profile-1',
    });
    const schedules = [
      Weekday.MONDAY,
      Weekday.TUESDAY,
      Weekday.WEDNESDAY,
      Weekday.THURSDAY,
      Weekday.FRIDAY,
      Weekday.SATURDAY,
      Weekday.SUNDAY,
    ].map((weekday) => ({
      weekday,
      isOpen: weekday === Weekday.MONDAY,
      opensAtLocal: weekday === Weekday.MONDAY ? '17:00' : null,
      closesAtLocal: weekday === Weekday.MONDAY ? '09:00' : null,
      maximumOperatingUntilLocal: null,
    }));

    await expect(
      service.updateDraftConfiguration('doctor-user-1', 'location-1', {
        timeZone: 'Asia/Manila',
        schedules,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects PracticeLocation creation when the authenticated User is not a Doctor owner', async () => {
    prismaServiceMock.doctorProfile.findUnique.mockResolvedValue(null);

    await expect(service.create('secretary-user-1', {})).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(prismaServiceMock.$transaction).not.toHaveBeenCalled();
  });
});
