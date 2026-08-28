import { BookingQuestionType } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PracticeLocationService } from './practice-location.service';

describe('PracticeLocationService Single Choice loading', () => {
  const prismaMock = {
    doctorProfile: { findUnique: jest.fn() },
    practiceLocation: { findMany: jest.fn() },
    doctorPracticeConfigurationDraftBookingQuestionOption: {
      findMany: jest.fn(),
    },
  };

  const service = new PracticeLocationService(
    prismaMock as unknown as PrismaService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    prismaMock.doctorProfile.findUnique.mockResolvedValue({ id: 'doctor-1' });
  });

  it('returns persisted draft Single Choice options in display order', async () => {
    prismaMock.practiceLocation.findMany.mockResolvedValue([
      {
        id: 'clinic-1',
        bookingQuestions: [],
        doctorScheduleDraft: {
          bookingQuestions: [
            {
              id: 'draft-question-1',
              effectiveBookingQuestionId: null,
              type: BookingQuestionType.SINGLE_SELECT,
            },
          ],
        },
      },
    ]);
    prismaMock.doctorPracticeConfigurationDraftBookingQuestionOption.findMany.mockResolvedValue(
      [
        {
          bookingQuestionDraftId: 'draft-question-1',
          optionValue: 'NEW',
          optionLabel: 'New patient',
          displayOrder: 0,
        },
        {
          bookingQuestionDraftId: 'draft-question-1',
          optionValue: 'RETURNING',
          optionLabel: 'Returning patient',
          displayOrder: 1,
        },
      ],
    );

    const result = await service.findAllForDoctor('doctor-user');

    expect(result[0].doctorScheduleDraft?.bookingQuestions[0]).toEqual(
      expect.objectContaining({
        selectOptions: [
          { value: 'NEW', label: 'New patient' },
          { value: 'RETURNING', label: 'Returning patient' },
        ],
      }),
    );
  });

  it('recovers effective Single Choice options for a legacy draft created before draft-option storage', async () => {
    const effectiveOptions = [
      { value: 'NEW', label: 'New patient' },
      { value: 'RETURNING', label: 'Returning patient' },
    ];
    prismaMock.practiceLocation.findMany.mockResolvedValue([
      {
        id: 'clinic-1',
        bookingQuestions: [
          {
            id: 'effective-question-1',
            type: BookingQuestionType.SINGLE_SELECT,
            selectOptions: effectiveOptions,
          },
        ],
        doctorScheduleDraft: {
          bookingQuestions: [
            {
              id: 'legacy-draft-question-1',
              effectiveBookingQuestionId: 'effective-question-1',
              type: BookingQuestionType.SINGLE_SELECT,
            },
          ],
        },
      },
    ]);
    prismaMock.doctorPracticeConfigurationDraftBookingQuestionOption.findMany.mockResolvedValue(
      [],
    );

    const result = await service.findAllForDoctor('doctor-user');

    expect(
      result[0].doctorScheduleDraft?.bookingQuestions[0].selectOptions,
    ).toEqual(effectiveOptions);
  });
});
