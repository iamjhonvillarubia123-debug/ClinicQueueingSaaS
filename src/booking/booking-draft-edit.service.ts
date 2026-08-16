import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import {
  BookingDraftMode,
  Prisma,
  ServiceAvailabilityStatus,
} from '../../generated/prisma/client';
import { OtpService } from '../otp/otp.service';
import { PrismaService } from '../prisma/prisma.service';
import { MobileNumberService } from '../security/mobile-number/mobile-number.service';
import {
  ActiveBookingQuestion,
  BookingAnswerValidationService,
  PreparedBookingDraftAnswer,
} from './booking-answer-validation.service';
import { BookingConfigurationService } from './booking-configuration.service';
import { BookingDraftControlService } from './booking-draft-control.service';
import { CreateBookingDraftMemberDto } from './dto/create-booking-draft.dto';
import {
  BookingDraftControlDto,
  ReplaceBookingDraftDto,
} from './dto/replace-booking-draft.dto';

type SelectedService = {
  id: string;
  name: string;
  durationMinutes: number;
};

type PreparedMember = {
  memberOrder: number;
  member: CreateBookingDraftMemberDto;
  selectedServices: SelectedService[];
  preparedAnswers: PreparedBookingDraftAnswer[];
  estimatedServiceMinutes: number;
  requiredAnswersComplete: boolean;
};

@Injectable()
export class BookingDraftEditService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mobileNumberService: MobileNumberService,
    private readonly bookingConfigurationService: BookingConfigurationService,
    private readonly bookingAnswerValidationService: BookingAnswerValidationService,
    private readonly bookingDraftControlService: BookingDraftControlService,
    private readonly otpService: OtpService,
  ) {}

  async replaceDraft(bookingDraftId: string, dto: ReplaceBookingDraftDto) {
    const activeQuestions =
      await this.bookingAnswerValidationService.loadActiveQuestions(
        dto.practiceLocationId,
      );
    const location = await this.prisma.practiceLocation.findUnique({
      where: { id: dto.practiceLocationId },
      select: {
        doctorProfile: {
          select: {
            accountSettings: {
              select: {
                maximumEstimatedServiceMinutesPerPatient: true,
              },
            },
          },
        },
      },
    });
    const accountSettings = location?.doctorProfile.accountSettings;
    if (!accountSettings) {
      throw new InternalServerErrorException(
        'Practice location configuration is incomplete.',
      );
    }

    const protectedMobile = this.mobileNumberService.protect(dto.mobileNumber);
    const serviceDate = new Date(`${dto.serviceDate}T00:00:00.000Z`);
    const cap = accountSettings.maximumEstimatedServiceMinutesPerPatient;

    const prepared =
      dto.mode === 'MULTI_PERSON'
        ? await this.prepareMultiPerson(dto, activeQuestions, cap)
        : await this.prepareIndividual(dto, activeQuestions, cap);

    return this.prisma.$transaction(async (transaction) => {
      const locked =
        await this.bookingDraftControlService.requireEditableDraftForUpdate(
          transaction,
          bookingDraftId,
          dto.draftControlToken,
        );

      if (locked.practiceLocationId !== dto.practiceLocationId) {
        throw new BadRequestException(
          'PracticeLocation cannot be changed on an existing BookingDraft. Start a new booking instead.',
        );
      }
      if (locked.mode !== dto.mode) {
        throw new BadRequestException(
          'BookingDraft mode cannot be changed. Start a new booking instead.',
        );
      }

      const existing = await transaction.bookingDraft.findUniqueOrThrow({
        where: { id: bookingDraftId },
        select: {
          id: true,
          mode: true,
          practiceLocationId: true,
          firstName: true,
          middleName: true,
          lastName: true,
          suffix: true,
          existingPatientResponse: true,
          mobileNumberHash: true,
          serviceDate: true,
          serviceSelections: {
            where: { bookingDraftMemberId: null },
            select: { practiceLocationServiceId: true },
          },
          bookingDraftAnswers: {
            where: { bookingDraftMemberId: null },
            select: this.answerSelect,
          },
          bookingDraftMembers: {
            orderBy: { memberOrder: 'asc' },
            select: {
              id: true,
              memberOrder: true,
              firstName: true,
              middleName: true,
              lastName: true,
              suffix: true,
              existingPatientResponse: true,
              serviceSelections: {
                select: { practiceLocationServiceId: true },
              },
              answers: { select: this.answerSelect },
            },
          },
        },
      });

      const before = this.existingFingerprint(existing);
      const after = this.preparedFingerprint(
        dto,
        protectedMobile.hash,
        serviceDate,
        prepared,
      );
      const materialChanged = before !== after;

      if (!materialChanged) {
        return {
          bookingDraftId,
          materialChanged: false,
          otpInvalidated: false,
          otpEligible: prepared.otpEligible,
          expiresAt: locked.expiresAt,
        };
      }

      const invalidated = await transaction.otpVerification.updateMany({
        where: {
          bookingDraftId,
          purpose: 'BOOKING',
          consumedAt: null,
          invalidatedAt: null,
        },
        data: { invalidatedAt: new Date() },
      });

      await transaction.bookingDraftAnswer.deleteMany({
        where: { bookingDraftId },
      });
      await transaction.bookingDraftServiceSelection.deleteMany({
        where: { bookingDraftId },
      });

      if (dto.mode === 'MULTI_PERSON') {
        await transaction.bookingDraftMember.deleteMany({
          where: { bookingDraftId },
        });
        await transaction.bookingDraft.update({
          where: { id: bookingDraftId },
          data: {
            firstName: null,
            middleName: null,
            lastName: null,
            suffix: null,
            existingPatientResponse: null,
            mobileNumberEncrypted: protectedMobile.encrypted,
            mobileNumberHash: protectedMobile.hash,
            mobileNumberLastFour: protectedMobile.lastFour,
            serviceDate,
            estimatedServiceMinutes: null,
          },
        });
        await this.writeMembers(transaction, bookingDraftId, prepared.members);
      } else {
        await transaction.bookingDraft.update({
          where: { id: bookingDraftId },
          data: {
            firstName: prepared.firstName,
            middleName: prepared.middleName,
            lastName: prepared.lastName,
            suffix: prepared.suffix,
            existingPatientResponse: prepared.existingPatientResponse,
            mobileNumberEncrypted: protectedMobile.encrypted,
            mobileNumberHash: protectedMobile.hash,
            mobileNumberLastFour: protectedMobile.lastFour,
            serviceDate,
            estimatedServiceMinutes: prepared.estimatedServiceMinutes,
            serviceSelections: {
              create: prepared.selectedServices.map((service) => ({
                practiceLocationServiceId: service.id,
              })),
            },
            bookingDraftAnswers: {
              create: prepared.preparedAnswers.map((answer) =>
                this.answerCreateData(answer),
              ),
            },
          },
        });
      }

      return {
        bookingDraftId,
        materialChanged: true,
        otpInvalidated: invalidated.count > 0,
        otpEligible: prepared.otpEligible,
        expiresAt: locked.expiresAt,
      };
    });
  }

  async requestBookingOtp(bookingDraftId: string, dto: BookingDraftControlDto) {
    return this.prisma.$transaction(async (transaction) => {
      await this.bookingDraftControlService.requireEditableDraftForUpdate(
        transaction,
        bookingDraftId,
        dto.draftControlToken,
      );

      const draft = await transaction.bookingDraft.findUniqueOrThrow({
        where: { id: bookingDraftId },
        select: {
          id: true,
          mode: true,
          practiceLocationId: true,
          serviceSelections: {
            where: { bookingDraftMemberId: null },
            select: { practiceLocationServiceId: true },
          },
          bookingDraftAnswers: {
            where: { bookingDraftMemberId: null },
            select: { bookingQuestionId: true },
          },
          bookingDraftMembers: {
            orderBy: { memberOrder: 'asc' },
            select: {
              id: true,
              serviceSelections: {
                select: { practiceLocationServiceId: true },
              },
              answers: { select: { bookingQuestionId: true } },
            },
          },
          otpVerifications: {
            where: {
              purpose: 'BOOKING',
              verifiedAt: { not: null },
              consumedAt: null,
              invalidatedAt: null,
            },
            select: { id: true },
            take: 1,
          },
        },
      });

      if (draft.otpVerifications.length > 0) {
        throw new BadRequestException(
          'Booking draft is already verified. A new OTP is required only after a material edit invalidates the prior verification.',
        );
      }

      const questions = await transaction.bookingQuestion.findMany({
        where: {
          practiceLocationId: draft.practiceLocationId,
          isActive: true,
        },
        select: { id: true, isRequired: true },
      });
      if (questions.length > 5) {
        throw new BadRequestException(
          'Practice location configuration exceeds five active BookingQuestions.',
        );
      }
      const requiredIds = new Set(
        questions.filter((question) => question.isRequired).map((q) => q.id),
      );

      if (draft.mode === BookingDraftMode.INDIVIDUAL) {
        this.assertRequiredIds(
          requiredIds,
          draft.bookingDraftAnswers.map((answer) => answer.bookingQuestionId),
        );
        await this.assertSelectionsCurrentlyActive(
          transaction,
          draft.practiceLocationId,
          draft.serviceSelections.map(
            (selection) => selection.practiceLocationServiceId,
          ),
        );
      } else {
        if (
          draft.bookingDraftMembers.length < 2 ||
          draft.bookingDraftMembers.length > 5
        ) {
          throw new BadRequestException(
            'Multi-person booking requires between two and five final members before OTP can be requested.',
          );
        }
        for (const member of draft.bookingDraftMembers) {
          this.assertRequiredIds(
            requiredIds,
            member.answers.map((answer) => answer.bookingQuestionId),
          );
          await this.assertSelectionsCurrentlyActive(
            transaction,
            draft.practiceLocationId,
            member.serviceSelections.map(
              (selection) => selection.practiceLocationServiceId,
            ),
          );
        }
      }

      const otp = await this.otpService.createBookingOtpInTransaction(
        transaction,
        bookingDraftId,
      );

      return {
        bookingDraftId,
        otpVerification: {
          id: otp.otpVerification.id,
          expiresAt: otp.otpVerification.expiresAt,
          maxAttempts: 5,
        },
      };
    });
  }

  private async prepareIndividual(
    dto: ReplaceBookingDraftDto,
    activeQuestions: ActiveBookingQuestion[],
    cap: number | null,
  ) {
    if (
      !dto.firstName ||
      !dto.lastName ||
      !dto.existingPatientResponse ||
      !dto.selectedServiceIds
    ) {
      throw new BadRequestException(
        'Individual booking draft requires person details and selected Services.',
      );
    }
    const selectedServices =
      await this.bookingConfigurationService.validateSelectedServices(
        dto.practiceLocationId,
        dto.selectedServiceIds,
      );
    const preparedAnswers = this.bookingAnswerValidationService.prepareAnswers(
      activeQuestions,
      dto.answers,
    );

    return {
      otpEligible: this.bookingAnswerValidationService.requiredAnswersComplete(
        activeQuestions,
        preparedAnswers,
      ),
      firstName: dto.firstName.trim(),
      middleName: dto.middleName?.trim() || null,
      lastName: dto.lastName.trim(),
      suffix: dto.suffix?.trim() || null,
      existingPatientResponse: dto.existingPatientResponse,
      selectedServices,
      preparedAnswers,
      estimatedServiceMinutes: this.calculateEstimatedServiceMinutes(
        selectedServices,
        cap,
      ),
      members: [] as PreparedMember[],
    };
  }

  private async prepareMultiPerson(
    dto: ReplaceBookingDraftDto,
    activeQuestions: ActiveBookingQuestion[],
    cap: number | null,
  ) {
    const members = dto.members;
    if (!members || members.length < 1 || members.length > 5) {
      throw new BadRequestException(
        'Multi-person booking draft requires between one and five temporary members while being edited.',
      );
    }
    const preparedMembers = await Promise.all(
      members.map(async (member, index) => {
        const selectedServices =
          await this.bookingConfigurationService.validateSelectedServices(
            dto.practiceLocationId,
            member.selectedServiceIds,
          );
        const preparedAnswers =
          this.bookingAnswerValidationService.prepareAnswers(
            activeQuestions,
            member.answers,
          );
        return {
          memberOrder: index + 1,
          member,
          selectedServices,
          preparedAnswers,
          estimatedServiceMinutes: this.calculateEstimatedServiceMinutes(
            selectedServices,
            cap,
          ),
          requiredAnswersComplete:
            this.bookingAnswerValidationService.requiredAnswersComplete(
              activeQuestions,
              preparedAnswers,
            ),
        } satisfies PreparedMember;
      }),
    );

    return {
      otpEligible:
        preparedMembers.length >= 2 &&
        preparedMembers.every((member) => member.requiredAnswersComplete),
      firstName: null,
      middleName: null,
      lastName: null,
      suffix: null,
      existingPatientResponse: null,
      selectedServices: [] as SelectedService[],
      preparedAnswers: [] as PreparedBookingDraftAnswer[],
      estimatedServiceMinutes: null,
      members: preparedMembers,
    };
  }

  private async writeMembers(
    transaction: Prisma.TransactionClient,
    bookingDraftId: string,
    members: PreparedMember[],
  ) {
    for (const prepared of members) {
      const member = await transaction.bookingDraftMember.create({
        data: {
          bookingDraftId,
          memberOrder: prepared.memberOrder,
          firstName: prepared.member.firstName.trim(),
          middleName: prepared.member.middleName?.trim() || null,
          lastName: prepared.member.lastName.trim(),
          suffix: prepared.member.suffix?.trim() || null,
          existingPatientResponse: prepared.member.existingPatientResponse,
          estimatedServiceMinutes: prepared.estimatedServiceMinutes,
        },
        select: { id: true },
      });
      await transaction.bookingDraftServiceSelection.createMany({
        data: prepared.selectedServices.map((service) => ({
          bookingDraftId,
          bookingDraftMemberId: member.id,
          practiceLocationServiceId: service.id,
        })),
      });
      if (prepared.preparedAnswers.length > 0) {
        await transaction.bookingDraftAnswer.createMany({
          data: prepared.preparedAnswers.map((answer) => ({
            bookingDraftId,
            bookingDraftMemberId: member.id,
            ...this.answerCreateData(answer),
          })),
        });
      }
    }
  }

  private existingFingerprint(existing: {
    mode: BookingDraftMode;
    practiceLocationId: string;
    firstName: string | null;
    middleName: string | null;
    lastName: string | null;
    suffix: string | null;
    existingPatientResponse: string | null;
    mobileNumberHash: string | null;
    serviceDate: Date;
    serviceSelections: { practiceLocationServiceId: string }[];
    bookingDraftAnswers: Array<{
      bookingQuestionId: string;
      answerText: string | null;
      answerNumber: Prisma.Decimal | null;
      answerBoolean: boolean | null;
      selectedOptionValue: string | null;
    }>;
    bookingDraftMembers: Array<{
      memberOrder: number;
      firstName: string | null;
      middleName: string | null;
      lastName: string | null;
      suffix: string | null;
      existingPatientResponse: string | null;
      serviceSelections: { practiceLocationServiceId: string }[];
      answers: Array<{
        bookingQuestionId: string;
        answerText: string | null;
        answerNumber: Prisma.Decimal | null;
        answerBoolean: boolean | null;
        selectedOptionValue: string | null;
      }>;
    }>;
  }): string {
    return JSON.stringify({
      mode: existing.mode,
      practiceLocationId: existing.practiceLocationId,
      mobileNumberHash: existing.mobileNumberHash,
      serviceDate: this.dateKey(existing.serviceDate),
      person:
        existing.mode === BookingDraftMode.INDIVIDUAL
          ? {
              firstName: existing.firstName,
              middleName: existing.middleName,
              lastName: existing.lastName,
              suffix: existing.suffix,
              existingPatientResponse: existing.existingPatientResponse,
              selectedServiceIds: this.sortedIds(existing.serviceSelections),
              answers: this.canonicalAnswers(existing.bookingDraftAnswers),
            }
          : null,
      members:
        existing.mode === BookingDraftMode.MULTI_PERSON
          ? existing.bookingDraftMembers.map((member) => ({
              memberOrder: member.memberOrder,
              firstName: member.firstName,
              middleName: member.middleName,
              lastName: member.lastName,
              suffix: member.suffix,
              existingPatientResponse: member.existingPatientResponse,
              selectedServiceIds: this.sortedIds(member.serviceSelections),
              answers: this.canonicalAnswers(member.answers),
            }))
          : [],
    });
  }

  private preparedFingerprint(
    dto: ReplaceBookingDraftDto,
    mobileNumberHash: string,
    serviceDate: Date,
    prepared: Awaited<
      ReturnType<
        | BookingDraftEditService['prepareIndividual']
        | BookingDraftEditService['prepareMultiPerson']
      >
    >,
  ): string {
    return JSON.stringify({
      mode: dto.mode,
      practiceLocationId: dto.practiceLocationId,
      mobileNumberHash,
      serviceDate: this.dateKey(serviceDate),
      person:
        dto.mode === 'INDIVIDUAL'
          ? {
              firstName: prepared.firstName,
              middleName: prepared.middleName,
              lastName: prepared.lastName,
              suffix: prepared.suffix,
              existingPatientResponse: prepared.existingPatientResponse,
              selectedServiceIds: prepared.selectedServices
                .map((service) => service.id)
                .sort(),
              answers: this.canonicalAnswers(prepared.preparedAnswers),
            }
          : null,
      members:
        dto.mode === 'MULTI_PERSON'
          ? prepared.members.map((member) => ({
              memberOrder: member.memberOrder,
              firstName: member.member.firstName.trim(),
              middleName: member.member.middleName?.trim() || null,
              lastName: member.member.lastName.trim(),
              suffix: member.member.suffix?.trim() || null,
              existingPatientResponse: member.member.existingPatientResponse,
              selectedServiceIds: member.selectedServices
                .map((service) => service.id)
                .sort(),
              answers: this.canonicalAnswers(member.preparedAnswers),
            }))
          : [],
    });
  }

  private canonicalAnswers(
    answers: Array<{
      bookingQuestionId: string;
      answerText: string | null;
      answerNumber: Prisma.Decimal | null;
      answerBoolean: boolean | null;
      selectedOptionValue: string | null;
    }>,
  ) {
    return answers
      .map((answer) => ({
        bookingQuestionId: answer.bookingQuestionId,
        answerText: answer.answerText,
        answerNumber: answer.answerNumber?.toString() ?? null,
        answerBoolean: answer.answerBoolean,
        selectedOptionValue: answer.selectedOptionValue,
      }))
      .sort((a, b) => a.bookingQuestionId.localeCompare(b.bookingQuestionId));
  }

  private sortedIds(
    selections: Array<{ practiceLocationServiceId: string }>,
  ): string[] {
    return selections
      .map((selection) => selection.practiceLocationServiceId)
      .sort();
  }

  private dateKey(value: Date): string {
    return value.toISOString().slice(0, 10);
  }

  private answerCreateData(answer: PreparedBookingDraftAnswer) {
    return {
      bookingQuestionId: answer.bookingQuestionId,
      answerText: answer.answerText,
      answerNumber: answer.answerNumber,
      answerBoolean: answer.answerBoolean,
      selectedOptionValue: answer.selectedOptionValue,
    };
  }

  private calculateEstimatedServiceMinutes(
    selectedServices: SelectedService[],
    cap: number | null,
  ): number {
    const total = selectedServices.reduce(
      (sum, service) => sum + service.durationMinutes,
      0,
    );
    return cap === null ? total : Math.min(total, cap);
  }

  private assertRequiredIds(requiredIds: Set<string>, answeredIds: string[]) {
    const answered = new Set(answeredIds);
    if ([...requiredIds].some((id) => !answered.has(id))) {
      throw new BadRequestException(
        'All required BookingQuestions must be answered before booking OTP can be requested.',
      );
    }
  }

  private async assertSelectionsCurrentlyActive(
    transaction: Prisma.TransactionClient,
    practiceLocationId: string,
    selectedIds: string[],
  ) {
    if (selectedIds.length < 1 || selectedIds.length > 3) {
      throw new BadRequestException(
        'Each prospective patient must have between one and three selected Services before booking OTP can be requested.',
      );
    }
    const services = await transaction.practiceLocationService.findMany({
      where: {
        id: { in: selectedIds },
        practiceLocationId,
        status: ServiceAvailabilityStatus.ACTIVE,
      },
      select: { id: true, durationMinutes: true },
    });
    if (
      services.length !== new Set(selectedIds).size ||
      services.some((service) => service.durationMinutes < 1)
    ) {
      throw new BadRequestException(
        'One or more selected Services are no longer available for booking.',
      );
    }
  }

  private readonly answerSelect = {
    bookingQuestionId: true,
    answerText: true,
    answerNumber: true,
    answerBoolean: true,
    selectedOptionValue: true,
  } satisfies Prisma.BookingDraftAnswerSelect;
}
