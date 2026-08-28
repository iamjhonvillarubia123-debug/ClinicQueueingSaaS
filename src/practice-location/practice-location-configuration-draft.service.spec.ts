import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import {
  BookingQuestionType,
  PracticeLocationLifecycleStatus,
  ServiceAvailabilityStatus,
  Weekday,
} from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PracticeLocationConfigurationDraftService } from './practice-location-configuration-draft.service';

describe('PracticeLocationConfigurationDraftService', () => {
  let service: PracticeLocationConfigurationDraftService;

  const transactionMock = {
    practiceLocation: {
      findFirst: jest.fn(),
      update: jest.fn(),
      findUniqueOrThrow: jest.fn(),
    },
    practiceSchedule: { upsert: jest.fn() },
    practiceLocationService: {
      deleteMany: jest.fn(),
      createMany: jest.fn(),
    },
    bookingQuestion: {
      findMany: jest.fn(),
      deleteMany: jest.fn(),
      createMany: jest.fn(),
    },
    doctorPracticeScheduleDraft: { upsert: jest.fn() },
    doctorPracticeScheduleDraftRow: {
      deleteMany: jest.fn(),
      createMany: jest.fn(),
    },
    doctorPracticeConfigurationDraftService: {
      deleteMany: jest.fn(),
      createMany: jest.fn(),
    },
    doctorPracticeConfigurationDraftBookingQuestion: {
      deleteMany: jest.fn(),
      create: jest.fn(),
    },
    doctorPracticeConfigurationDraftBookingQuestionOption: {
      createMany: jest.fn(),
      findMany: jest.fn(),
    },
  };

  const prismaMock = {
    doctorProfile: { findUnique: jest.fn() },
    $transaction: jest.fn(
      (callback: (transaction: typeof transactionMock) => unknown) =>
        callback(transactionMock),
    ),
  };

  const schedules = Object.values(Weekday).map((weekday, index) => ({
    weekday,
    isOpen: index < 5,
    opensAtLocal: index < 5 ? '08:00' : undefined,
    closesAtLocal: index < 5 ? '17:00' : undefined,
    maximumOnlineBookingUntilLocal: index < 5 ? '15:00' : undefined,
    maximumOperatingUntilLocal: index < 5 ? '18:00' : undefined,
  }));

  const dto = {
    basicInfo: {
      name: 'Draft Clinic Name',
      shortCode: 'north',
      addressLine1: 'Draft Street',
      clinicEmail: 'draft@example.com',
      clinicDescription: 'Draft description',
      countryCode: 'PH',
      timeZone: 'Asia/Manila',
    },
    schedules,
    services: [
      {
        effectiveServiceId: 'service-1',
        name: 'Draft Consultation',
        description: 'Draft wording',
        durationMinutes: 45,
        status: ServiceAvailabilityStatus.ACTIVE,
      },
    ],
    bookingQuestions: [
      {
        effectiveBookingQuestionId: 'question-1',
        questionText: 'Draft question?',
        type: BookingQuestionType.TEXT,
        isRequired: true,
        displayOrder: 0,
        isActive: true,
      },
    ],
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PracticeLocationConfigurationDraftService,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();
    service = module.get(PracticeLocationConfigurationDraftService);
    jest.clearAllMocks();
    prismaMock.doctorProfile.findUnique.mockResolvedValue({ id: 'doctor-1' });
    transactionMock.practiceLocation.findFirst
      .mockResolvedValueOnce({
        id: 'location-1',
        lifecycleStatus: PracticeLocationLifecycleStatus.ACTIVE,
      })
      .mockResolvedValueOnce(null);
    transactionMock.bookingQuestion.findMany.mockResolvedValue([]);
    transactionMock.doctorPracticeScheduleDraft.upsert.mockResolvedValue({
      id: 'doctor-draft-1',
    });
    transactionMock.doctorPracticeConfigurationDraftBookingQuestion.create.mockResolvedValue(
      { id: 'draft-question-1' },
    );
    transactionMock.doctorPracticeConfigurationDraftBookingQuestionOption.findMany.mockResolvedValue(
      [],
    );
    transactionMock.practiceLocation.findUniqueOrThrow.mockResolvedValue({
      id: 'location-1',
    });
  });

  it('stores an ACTIVE clinic proposal without mutating effective configuration', async () => {
    await service.save('user-1', 'location-1', dto);

    expect(transactionMock.practiceLocation.update).not.toHaveBeenCalled();
    expect(transactionMock.practiceSchedule.upsert).not.toHaveBeenCalled();
    expect(transactionMock.practiceLocationService.deleteMany).not.toHaveBeenCalled();
    expect(transactionMock.bookingQuestion.deleteMany).not.toHaveBeenCalled();

    expect(transactionMock.doctorPracticeScheduleDraft.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { practiceLocationId: 'location-1' },
        update: expect.objectContaining({
          name: 'Draft Clinic Name',
          shortCode: 'NORTH',
          timeZone: 'Asia/Manila',
        }),
      }),
    );
    expect(
      transactionMock.doctorPracticeConfigurationDraftService.createMany,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          expect.objectContaining({
            effectiveServiceId: 'service-1',
            name: 'Draft Consultation',
            durationMinutes: 45,
          }),
        ],
      }),
    );
    expect(
      transactionMock.doctorPracticeConfigurationDraftBookingQuestion.create,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          effectiveBookingQuestionId: 'question-1',
          questionText: 'Draft question?',
          displayOrder: 0,
        }),
      }),
    );
  });

  it('stores Single Choice options in an ACTIVE clinic draft with stable values and labels', async () => {
    await service.save('user-1', 'location-1', {
      ...dto,
      bookingQuestions: [
        {
          effectiveBookingQuestionId: 'question-1',
          questionText: 'Preferred consultation type?',
          type: BookingQuestionType.SINGLE_SELECT,
          isRequired: true,
          displayOrder: 0,
          isActive: true,
          selectOptions: [
            { value: 'GENERAL', label: 'General Consultation' },
            { value: 'FOLLOW_UP', label: 'Follow-up Consultation' },
          ],
        },
      ],
    });

    expect(
      transactionMock.doctorPracticeConfigurationDraftBookingQuestionOption.createMany,
    ).toHaveBeenCalledWith({
      data: [
        {
          bookingQuestionDraftId: 'draft-question-1',
          optionValue: 'GENERAL',
          optionLabel: 'General Consultation',
          displayOrder: 0,
        },
        {
          bookingQuestionDraftId: 'draft-question-1',
          optionValue: 'FOLLOW_UP',
          optionLabel: 'Follow-up Consultation',
          displayOrder: 1,
        },
      ],
    });
  });

  it('stores DRAFT setup while preserving hidden BookingQuestion operational meaning', async () => {
    transactionMock.practiceLocation.findFirst.mockReset();
    transactionMock.practiceLocation.findFirst
      .mockResolvedValueOnce({
        id: 'location-1',
        lifecycleStatus: PracticeLocationLifecycleStatus.DRAFT,
      })
      .mockResolvedValueOnce(null);
    transactionMock.bookingQuestion.findMany.mockResolvedValue([
      {
        id: 'question-1',
        helpText: 'Existing help',
        estimatedMinutesAdjustment: 15,
        textMaximumLength: 250,
        numberMinimum: null,
        numberMaximum: null,
        selectOptions: null,
      },
    ]);

    await service.save('user-1', 'location-1', dto);

    expect(transactionMock.practiceLocation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'location-1' },
        data: expect.objectContaining({
          name: 'Draft Clinic Name',
          shortCode: 'NORTH',
          clinicEmail: 'draft@example.com',
        }),
      }),
    );
    expect(transactionMock.practiceSchedule.upsert).toHaveBeenCalledTimes(7);
    expect(transactionMock.practiceLocationService.createMany).toHaveBeenCalled();
    expect(transactionMock.bookingQuestion.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          questionText: 'Draft question?',
          displayOrder: 0,
          helpText: 'Existing help',
          estimatedMinutesAdjustment: 15,
          textMaximumLength: 250,
        }),
      ],
    });
    expect(transactionMock.doctorPracticeScheduleDraft.upsert).not.toHaveBeenCalled();
  });

  it('stores Single Choice options directly for a DRAFT clinic setup', async () => {
    transactionMock.practiceLocation.findFirst.mockReset();
    transactionMock.practiceLocation.findFirst.mockResolvedValueOnce({
      id: 'location-1',
      lifecycleStatus: PracticeLocationLifecycleStatus.DRAFT,
    });
    transactionMock.bookingQuestion.findMany.mockResolvedValue([]);

    await service.save('user-1', 'location-1', {
      ...dto,
      bookingQuestions: [
        {
          questionText: 'Preferred consultation type?',
          type: BookingQuestionType.SINGLE_SELECT,
          isRequired: false,
          displayOrder: 0,
          isActive: true,
          selectOptions: [
            { value: 'GENERAL', label: 'General Consultation' },
            { value: 'FOLLOW_UP', label: 'Follow-up Consultation' },
          ],
        },
      ],
    });

    expect(transactionMock.bookingQuestion.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          selectOptions: [
            { value: 'GENERAL', label: 'General Consultation' },
            { value: 'FOLLOW_UP', label: 'Follow-up Consultation' },
          ],
        }),
      ],
    });
  });

  it('rejects a cross-clinic BookingQuestion reference in DRAFT setup', async () => {
    transactionMock.practiceLocation.findFirst.mockReset();
    transactionMock.practiceLocation.findFirst
      .mockResolvedValueOnce({
        id: 'location-1',
        lifecycleStatus: PracticeLocationLifecycleStatus.DRAFT,
      })
      .mockResolvedValueOnce(null);
    transactionMock.bookingQuestion.findMany.mockResolvedValue([]);

    await expect(service.save('user-1', 'location-1', dto)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(transactionMock.bookingQuestion.deleteMany).not.toHaveBeenCalled();
  });

  it('permits display order zero but rejects more than five active questions', async () => {
    const sixActiveQuestions = Array.from({ length: 6 }, (_, index) => ({
      questionText: `Question ${index}`,
      type: BookingQuestionType.TEXT,
      isRequired: false,
      displayOrder: index,
      isActive: true,
    }));

    await expect(
      service.save('user-1', 'location-1', {
        ...dto,
        bookingQuestions: sixActiveQuestions,
      }),
    ).rejects.toThrow('no more than 5 active BookingQuestions');
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('rejects a Single Choice question with fewer than two options', async () => {
    await expect(
      service.save('user-1', 'location-1', {
        ...dto,
        bookingQuestions: [
          {
            questionText: 'Preferred consultation type?',
            type: BookingQuestionType.SINGLE_SELECT,
            isRequired: false,
            displayOrder: 0,
            isActive: true,
            selectOptions: [{ value: 'GENERAL', label: 'General Consultation' }],
          },
        ],
      }),
    ).rejects.toThrow('require at least 2 options');
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('rejects duplicate Single Choice option values', async () => {
    await expect(
      service.save('user-1', 'location-1', {
        ...dto,
        bookingQuestions: [
          {
            questionText: 'Preferred consultation type?',
            type: BookingQuestionType.SINGLE_SELECT,
            isRequired: false,
            displayOrder: 0,
            isActive: true,
            selectOptions: [
              { value: 'GENERAL', label: 'General Consultation' },
              { value: 'GENERAL', label: 'Another General Label' },
            ],
          },
        ],
      }),
    ).rejects.toThrow('option values must be unique');
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });
});
