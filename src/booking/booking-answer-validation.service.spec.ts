import { BadRequestException } from '@nestjs/common';
import { BookingQuestionType, Prisma } from '../../generated/prisma/client';
import { BookingAnswerValidationService } from './booking-answer-validation.service';

describe('BookingAnswerValidationService', () => {
  const prismaServiceMock = {
    bookingQuestion: { findMany: jest.fn() },
  };
  let service: BookingAnswerValidationService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new BookingAnswerValidationService(prismaServiceMock as never);
  });

  it('loads only active questions from the selected PracticeLocation', async () => {
    prismaServiceMock.bookingQuestion.findMany.mockResolvedValue([]);

    await service.loadActiveQuestions('location-1');

    expect(prismaServiceMock.bookingQuestion.findMany).toHaveBeenCalledWith({
      where: { practiceLocationId: 'location-1', isActive: true },
      orderBy: { displayOrder: 'asc' },
      select: {
        id: true,
        type: true,
        isRequired: true,
        textMaximumLength: true,
        numberMinimum: true,
        numberMaximum: true,
        selectOptions: true,
      },
    });
  });

  it('normalizes typed answers and treats false as a present BOOLEAN answer', () => {
    const questions = [
      {
        id: 'text-q',
        type: BookingQuestionType.TEXT,
        isRequired: true,
        textMaximumLength: 20,
        numberMinimum: null,
        numberMaximum: null,
        selectOptions: null,
      },
      {
        id: 'bool-q',
        type: BookingQuestionType.BOOLEAN,
        isRequired: true,
        textMaximumLength: null,
        numberMinimum: null,
        numberMaximum: null,
        selectOptions: null,
      },
    ];

    const prepared = service.prepareAnswers(questions, [
      { bookingQuestionId: 'text-q', answerText: '  prepared  ' },
      { bookingQuestionId: 'bool-q', answerBoolean: false },
    ]);

    expect(prepared).toEqual([
      {
        bookingQuestionId: 'text-q',
        answerText: 'prepared',
        answerNumber: null,
        answerBoolean: null,
        selectedOptionValue: null,
      },
      {
        bookingQuestionId: 'bool-q',
        answerText: null,
        answerNumber: null,
        answerBoolean: false,
        selectedOptionValue: null,
      },
    ]);
    expect(service.requiredAnswersComplete(questions, prepared)).toBe(true);
  });

  it('rejects duplicate, cross-location/stale, and wrong-type answer submissions', () => {
    const questions = [
      {
        id: 'text-q',
        type: BookingQuestionType.TEXT,
        isRequired: false,
        textMaximumLength: 20,
        numberMinimum: null,
        numberMaximum: null,
        selectOptions: null,
      },
    ];

    expect(() =>
      service.prepareAnswers(questions, [
        { bookingQuestionId: 'text-q', answerText: 'a' },
        { bookingQuestionId: 'text-q', answerText: 'b' },
      ]),
    ).toThrow(BadRequestException);
    expect(() =>
      service.prepareAnswers(questions, [
        { bookingQuestionId: 'other-q', answerText: 'a' },
      ]),
    ).toThrow(BadRequestException);
    expect(() =>
      service.prepareAnswers(questions, [
        { bookingQuestionId: 'text-q', answerBoolean: true },
      ]),
    ).toThrow(BadRequestException);
  });

  it('enforces number bounds and current SINGLE_SELECT option values', () => {
    const questions = [
      {
        id: 'number-q',
        type: BookingQuestionType.NUMBER,
        isRequired: false,
        textMaximumLength: null,
        numberMinimum: new Prisma.Decimal(1),
        numberMaximum: new Prisma.Decimal(10),
        selectOptions: null,
      },
      {
        id: 'select-q',
        type: BookingQuestionType.SINGLE_SELECT,
        isRequired: false,
        textMaximumLength: null,
        numberMinimum: null,
        numberMaximum: null,
        selectOptions: [
          { value: 'yes', label: 'Yes' },
          { value: 'no', label: 'No' },
        ],
      },
    ];

    expect(() =>
      service.prepareAnswers(questions, [
        { bookingQuestionId: 'number-q', answerNumber: 11 },
      ]),
    ).toThrow(BadRequestException);
    expect(() =>
      service.prepareAnswers(questions, [
        { bookingQuestionId: 'select-q', selectedOptionValue: 'maybe' },
      ]),
    ).toThrow(BadRequestException);

    const prepared = service.prepareAnswers(questions, [
      { bookingQuestionId: 'number-q', answerNumber: 5 },
      { bookingQuestionId: 'select-q', selectedOptionValue: 'yes' },
    ]);
    expect(prepared[0]?.answerNumber?.equals(5)).toBe(true);
    expect(prepared[1]?.selectedOptionValue).toBe('yes');
  });

  it('allows incomplete draft answers but reports required completeness as false', () => {
    const questions = [
      {
        id: 'required-q',
        type: BookingQuestionType.TEXT,
        isRequired: true,
        textMaximumLength: 20,
        numberMinimum: null,
        numberMaximum: null,
        selectOptions: null,
      },
    ];

    const prepared = service.prepareAnswers(questions, []);

    expect(prepared).toEqual([]);
    expect(service.requiredAnswersComplete(questions, prepared)).toBe(false);
  });
});
