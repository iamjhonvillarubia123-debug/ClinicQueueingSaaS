import { BadRequestException, Injectable } from '@nestjs/common';
import { BookingQuestionType, Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { BookingDraftAnswerDto } from './dto/booking-draft-answer.dto';

const ABSOLUTE_TEXT_ANSWER_MAX_LENGTH = 10_000;

export type ActiveBookingQuestion = {
  id: string;
  type: BookingQuestionType;
  isRequired: boolean;
  textMaximumLength: number | null;
  numberMinimum: Prisma.Decimal | null;
  numberMaximum: Prisma.Decimal | null;
  selectOptions: Prisma.JsonValue | null;
};

export type PreparedBookingDraftAnswer = {
  bookingQuestionId: string;
  answerText: string | null;
  answerNumber: Prisma.Decimal | null;
  answerBoolean: boolean | null;
  selectedOptionValue: string | null;
};

@Injectable()
export class BookingAnswerValidationService {
  constructor(private readonly prisma: PrismaService) {}

  async loadActiveQuestions(
    practiceLocationId: string,
  ): Promise<ActiveBookingQuestion[]> {
    return this.prisma.bookingQuestion.findMany({
      where: {
        practiceLocationId,
        isActive: true,
      },
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
  }

  prepareAnswers(
    questions: ActiveBookingQuestion[],
    submittedAnswers: BookingDraftAnswerDto[] | undefined,
  ): PreparedBookingDraftAnswer[] {
    const answers = submittedAnswers ?? [];
    const seenQuestionIds = new Set<string>();
    const questionById = new Map(
      questions.map((question) => [question.id, question]),
    );
    const preparedByQuestionId = new Map<
      string,
      PreparedBookingDraftAnswer
    >();

    for (const answer of answers) {
      if (!answer.bookingQuestionId?.trim()) {
        throw new BadRequestException('BookingQuestion id is required.');
      }
      if (seenQuestionIds.has(answer.bookingQuestionId)) {
        throw new BadRequestException(
          'Each BookingQuestion may be answered at most once per prospective patient.',
        );
      }
      seenQuestionIds.add(answer.bookingQuestionId);

      const question = questionById.get(answer.bookingQuestionId);
      if (!question) {
        throw new BadRequestException(
          'One or more BookingQuestion answers are unavailable for this PracticeLocation.',
        );
      }

      const prepared = this.prepareOne(question, answer);
      if (prepared) {
        preparedByQuestionId.set(question.id, prepared);
      }
    }

    return questions.flatMap((question) => {
      const prepared = preparedByQuestionId.get(question.id);
      return prepared ? [prepared] : [];
    });
  }

  requiredAnswersComplete(
    questions: ActiveBookingQuestion[],
    preparedAnswers: PreparedBookingDraftAnswer[],
  ): boolean {
    const answeredQuestionIds = new Set(
      preparedAnswers.map((answer) => answer.bookingQuestionId),
    );
    return questions.every(
      (question) => !question.isRequired || answeredQuestionIds.has(question.id),
    );
  }

  private prepareOne(
    question: ActiveBookingQuestion,
    answer: BookingDraftAnswerDto,
  ): PreparedBookingDraftAnswer | null {
    const populatedFields = [
      answer.answerText !== undefined,
      answer.answerNumber !== undefined,
      answer.answerBoolean !== undefined,
      answer.selectedOptionValue !== undefined,
    ].filter(Boolean).length;

    if (populatedFields > 1) {
      throw new BadRequestException(
        'A BookingQuestion answer may populate only the value field matching its question type.',
      );
    }

    switch (question.type) {
      case BookingQuestionType.TEXT:
        return this.prepareText(question, answer);
      case BookingQuestionType.NUMBER:
        return this.prepareNumber(question, answer);
      case BookingQuestionType.BOOLEAN:
        return this.prepareBoolean(question, answer);
      case BookingQuestionType.SINGLE_SELECT:
        return this.prepareSingleSelect(question, answer);
      default:
        throw new BadRequestException('Unsupported BookingQuestion type.');
    }
  }

  private prepareText(
    question: ActiveBookingQuestion,
    answer: BookingDraftAnswerDto,
  ): PreparedBookingDraftAnswer | null {
    if (
      answer.answerNumber !== undefined ||
      answer.answerBoolean !== undefined ||
      answer.selectedOptionValue !== undefined
    ) {
      throw new BadRequestException('TEXT BookingQuestions require answerText only.');
    }

    const value = answer.answerText?.trim() ?? '';
    if (!value) {
      return null;
    }

    const maximumLength = Math.min(
      question.textMaximumLength ?? ABSOLUTE_TEXT_ANSWER_MAX_LENGTH,
      ABSOLUTE_TEXT_ANSWER_MAX_LENGTH,
    );
    if (value.length > maximumLength) {
      throw new BadRequestException(
        'TEXT BookingQuestion answer exceeds the allowed length.',
      );
    }

    return this.prepared(question.id, { answerText: value });
  }

  private prepareNumber(
    question: ActiveBookingQuestion,
    answer: BookingDraftAnswerDto,
  ): PreparedBookingDraftAnswer | null {
    if (
      answer.answerText !== undefined ||
      answer.answerBoolean !== undefined ||
      answer.selectedOptionValue !== undefined
    ) {
      throw new BadRequestException(
        'NUMBER BookingQuestions require answerNumber only.',
      );
    }
    if (answer.answerNumber === undefined) {
      return null;
    }

    const value = new Prisma.Decimal(answer.answerNumber);
    if (question.numberMinimum && value.lessThan(question.numberMinimum)) {
      throw new BadRequestException(
        'NUMBER BookingQuestion answer is below the allowed minimum.',
      );
    }
    if (question.numberMaximum && value.greaterThan(question.numberMaximum)) {
      throw new BadRequestException(
        'NUMBER BookingQuestion answer exceeds the allowed maximum.',
      );
    }

    return this.prepared(question.id, { answerNumber: value });
  }

  private prepareBoolean(
    question: ActiveBookingQuestion,
    answer: BookingDraftAnswerDto,
  ): PreparedBookingDraftAnswer | null {
    if (
      answer.answerText !== undefined ||
      answer.answerNumber !== undefined ||
      answer.selectedOptionValue !== undefined
    ) {
      throw new BadRequestException(
        'BOOLEAN BookingQuestions require answerBoolean only.',
      );
    }
    if (answer.answerBoolean === undefined) {
      return null;
    }

    return this.prepared(question.id, { answerBoolean: answer.answerBoolean });
  }

  private prepareSingleSelect(
    question: ActiveBookingQuestion,
    answer: BookingDraftAnswerDto,
  ): PreparedBookingDraftAnswer | null {
    if (
      answer.answerText !== undefined ||
      answer.answerNumber !== undefined ||
      answer.answerBoolean !== undefined
    ) {
      throw new BadRequestException(
        'SINGLE_SELECT BookingQuestions require selectedOptionValue only.',
      );
    }

    const value = answer.selectedOptionValue?.trim() ?? '';
    if (!value) {
      return null;
    }

    const allowedValues = this.readSelectOptionValues(question.selectOptions);
    if (!allowedValues.has(value)) {
      throw new BadRequestException(
        'Selected BookingQuestion option is not part of the current configured options.',
      );
    }

    return this.prepared(question.id, { selectedOptionValue: value });
  }

  private readSelectOptionValues(
    selectOptions: Prisma.JsonValue | null,
  ): Set<string> {
    if (!Array.isArray(selectOptions)) {
      return new Set();
    }

    return new Set(
      selectOptions.flatMap((option) => {
        if (
          option &&
          typeof option === 'object' &&
          !Array.isArray(option) &&
          typeof option.value === 'string'
        ) {
          return [option.value];
        }
        return [];
      }),
    );
  }

  private prepared(
    bookingQuestionId: string,
    values: Partial<Omit<PreparedBookingDraftAnswer, 'bookingQuestionId'>>,
  ): PreparedBookingDraftAnswer {
    return {
      bookingQuestionId,
      answerText: values.answerText ?? null,
      answerNumber: values.answerNumber ?? null,
      answerBoolean: values.answerBoolean ?? null,
      selectedOptionValue: values.selectedOptionValue ?? null,
    };
  }
}
