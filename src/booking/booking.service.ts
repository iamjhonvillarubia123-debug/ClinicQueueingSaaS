import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import {
  BookingDraftMode,
  PracticeLocationLifecycleStatus,
  Prisma,
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
import { BookingReferenceGenerator } from './booking-reference.generator';
import {
  CreateBookingDraftDto,
  CreateBookingDraftMemberDto,
} from './dto/create-booking-draft.dto';
import { VerifyBookingOtpDto } from './dto/verify-booking-otp.dto';

type SelectedService = {
  id: string;
  name: string;
  durationMinutes: number;
};

type ProtectedMobileNumber = {
  encrypted: string;
  hash: string;
  lastFour: string;
};

@Injectable()
export class BookingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mobileNumberService: MobileNumberService,
    private readonly bookingReferenceGenerator: BookingReferenceGenerator,
    private readonly otpService: OtpService,
    private readonly bookingConfigurationService: BookingConfigurationService,
    private readonly bookingAnswerValidationService: BookingAnswerValidationService,
    private readonly bookingDraftControlService: BookingDraftControlService,
  ) {}

  async createDraft(createBookingDraftDto: CreateBookingDraftDto) {
    const practiceLocation = await this.prisma.practiceLocation.findFirst({
      where: {
        id: createBookingDraftDto.practiceLocationId,
        lifecycleStatus: PracticeLocationLifecycleStatus.ACTIVE,
        isBookingEnabled: true,
        doctorProfile: {
          accountSettings: {
            allowOnlineBooking: true,
          },
        },
      },
      select: {
        id: true,
        name: true,
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

    if (!practiceLocation) {
      throw new NotFoundException(
        'Practice location is not available for online booking.',
      );
    }

    const accountSettings = practiceLocation.doctorProfile.accountSettings;
    if (!accountSettings) {
      throw new InternalServerErrorException(
        'Practice location configuration is incomplete.',
      );
    }

    const activeQuestions =
      await this.bookingAnswerValidationService.loadActiveQuestions(
        createBookingDraftDto.practiceLocationId,
      );
    const protectedMobileNumber = this.mobileNumberService.protect(
      createBookingDraftDto.mobileNumber,
    );
    const serviceDate = new Date(
      `${createBookingDraftDto.serviceDate}T00:00:00.000Z`,
    );
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
    const maximumEstimatedServiceMinutesPerPatient =
      accountSettings.maximumEstimatedServiceMinutesPerPatient;
    const controlCredential =
      this.bookingDraftControlService.issueCredential();

    const creation =
      createBookingDraftDto.mode === 'MULTI_PERSON'
        ? await this.createMultiPersonDraft(
            createBookingDraftDto,
            protectedMobileNumber,
            serviceDate,
            expiresAt,
            maximumEstimatedServiceMinutesPerPatient,
            activeQuestions,
            controlCredential.tokenHash,
          )
        : await this.createIndividualDraft(
            createBookingDraftDto,
            protectedMobileNumber,
            serviceDate,
            expiresAt,
            maximumEstimatedServiceMinutesPerPatient,
            activeQuestions,
            controlCredential.tokenHash,
          );

    if (!creation.otpEligible) {
      return {
        bookingDraft: creation.bookingDraft,
        draftControlToken: controlCredential.rawToken,
        otpVerification: null,
      };
    }

    const otpResult = await this.otpService.createBookingOtp(
      creation.bookingDraft.id,
    );

    return {
      bookingDraft: creation.bookingDraft,
      draftControlToken: controlCredential.rawToken,
      otpVerification: {
        id: otpResult.otpVerification.id,
        expiresAt: otpResult.otpVerification.expiresAt,
        maxAttempts: 5,
      },
    };
  }

  verifyBookingOtp(verifyBookingOtpDto: VerifyBookingOtpDto) {
    return this.otpService.verifyBookingOtp(
      verifyBookingOtpDto.bookingDraftId,
      verifyBookingOtpDto.otp,
    );
  }

  private async createIndividualDraft(
    dto: CreateBookingDraftDto,
    protectedMobileNumber: ProtectedMobileNumber,
    serviceDate: Date,
    expiresAt: Date,
    maximumEstimatedServiceMinutesPerPatient: number | null,
    activeQuestions: ActiveBookingQuestion[],
    draftControlTokenHash: string,
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
    const estimatedServiceMinutes = this.calculateEstimatedServiceMinutes(
      selectedServices,
      maximumEstimatedServiceMinutesPerPatient,
    );
    const preparedAnswers = this.bookingAnswerValidationService.prepareAnswers(
      activeQuestions,
      dto.answers,
    );
    const requiredAnswersComplete =
      this.bookingAnswerValidationService.requiredAnswersComplete(
        activeQuestions,
        preparedAnswers,
      );

    const maximumReferenceAttempts = 3;
    for (let attempt = 1; attempt <= maximumReferenceAttempts; attempt += 1) {
      const bookingReference = this.bookingReferenceGenerator.generate();

      try {
        const bookingDraft = await this.prisma.$transaction(
          async (transaction) => {
            const created = await transaction.bookingDraft.create({
              data: {
                bookingReference,
                mode: BookingDraftMode.INDIVIDUAL,
                practiceLocationId: dto.practiceLocationId,
                existingPatientResponse: dto.existingPatientResponse,
                firstName: dto.firstName.trim(),
                middleName: dto.middleName?.trim() || null,
                lastName: dto.lastName.trim(),
                suffix: dto.suffix?.trim() || null,
                mobileNumberEncrypted: protectedMobileNumber.encrypted,
                mobileNumberHash: protectedMobileNumber.hash,
                mobileNumberLastFour: protectedMobileNumber.lastFour,
                serviceDate,
                estimatedServiceMinutes,
                expiresAt,
                serviceSelections: {
                  create: selectedServices.map((service) => ({
                    practiceLocationServiceId: service.id,
                  })),
                },
                bookingDraftAnswers: {
                  create: preparedAnswers.map((answer) =>
                    this.answerCreateData(answer),
                  ),
                },
              },
              select: this.bookingDraftResultSelect,
            });

            await this.bookingDraftControlService.attachCredential(
              transaction,
              created.id,
              draftControlTokenHash,
            );

            return created;
          },
        );

        return {
          bookingDraft,
          otpEligible: requiredAnswersComplete,
        };
      } catch (error) {
        if (this.isUniqueConflict(error)) {
          continue;
        }
        throw error;
      }
    }

    throw new InternalServerErrorException(
      'Unable to generate a unique booking reference.',
    );
  }

  private async createMultiPersonDraft(
    dto: CreateBookingDraftDto,
    protectedMobileNumber: ProtectedMobileNumber,
    serviceDate: Date,
    expiresAt: Date,
    maximumEstimatedServiceMinutesPerPatient: number | null,
    activeQuestions: ActiveBookingQuestion[],
    draftControlTokenHash: string,
  ) {
    const members = dto.members;
    if (!members || members.length < 1 || members.length > 5) {
      throw new BadRequestException(
        'Multi-person booking draft requires between one and five temporary members while being edited.',
      );
    }

    const preparedMembers = await Promise.all(
      members.map(async (member, index) =>
        this.prepareMultiPersonMember(
          dto.practiceLocationId,
          member,
          index + 1,
          maximumEstimatedServiceMinutesPerPatient,
          activeQuestions,
        ),
      ),
    );
    const otpEligible =
      members.length >= 2 &&
      preparedMembers.every((member) => member.requiredAnswersComplete);

    const maximumReferenceAttempts = 3;
    for (let attempt = 1; attempt <= maximumReferenceAttempts; attempt += 1) {
      const bookingReference = this.bookingReferenceGenerator.generate();

      try {
        const bookingDraft = await this.prisma.$transaction(
          async (transaction) => {
            const parent = await transaction.bookingDraft.create({
              data: {
                bookingReference,
                mode: BookingDraftMode.MULTI_PERSON,
                practiceLocationId: dto.practiceLocationId,
                firstName: null,
                middleName: null,
                lastName: null,
                suffix: null,
                existingPatientResponse: null,
                mobileNumberEncrypted: protectedMobileNumber.encrypted,
                mobileNumberHash: protectedMobileNumber.hash,
                mobileNumberLastFour: protectedMobileNumber.lastFour,
                serviceDate,
                estimatedServiceMinutes: null,
                expiresAt,
              },
              select: this.bookingDraftResultSelect,
            });

            await this.bookingDraftControlService.attachCredential(
              transaction,
              parent.id,
              draftControlTokenHash,
            );

            for (const preparedMember of preparedMembers) {
              const createdMember = await transaction.bookingDraftMember.create(
                {
                  data: {
                    bookingDraftId: parent.id,
                    memberOrder: preparedMember.memberOrder,
                    firstName: preparedMember.member.firstName.trim(),
                    middleName:
                      preparedMember.member.middleName?.trim() || null,
                    lastName: preparedMember.member.lastName.trim(),
                    suffix: preparedMember.member.suffix?.trim() || null,
                    existingPatientResponse:
                      preparedMember.member.existingPatientResponse,
                    estimatedServiceMinutes:
                      preparedMember.estimatedServiceMinutes,
                  },
                  select: { id: true },
                },
              );

              await transaction.bookingDraftServiceSelection.createMany({
                data: preparedMember.selectedServices.map((service) => ({
                  bookingDraftId: parent.id,
                  bookingDraftMemberId: createdMember.id,
                  practiceLocationServiceId: service.id,
                })),
              });

              if (preparedMember.preparedAnswers.length > 0) {
                await transaction.bookingDraftAnswer.createMany({
                  data: preparedMember.preparedAnswers.map((answer) => ({
                    bookingDraftId: parent.id,
                    bookingDraftMemberId: createdMember.id,
                    ...this.answerCreateData(answer),
                  })),
                });
              }
            }

            return parent;
          },
        );

        return { bookingDraft, otpEligible };
      } catch (error) {
        if (this.isUniqueConflict(error)) {
          continue;
        }
        throw error;
      }
    }

    throw new InternalServerErrorException(
      'Unable to generate a unique booking reference.',
    );
  }

  private async prepareMultiPersonMember(
    practiceLocationId: string,
    member: CreateBookingDraftMemberDto,
    memberOrder: number,
    maximumEstimatedServiceMinutesPerPatient: number | null,
    activeQuestions: ActiveBookingQuestion[],
  ) {
    const selectedServices =
      await this.bookingConfigurationService.validateSelectedServices(
        practiceLocationId,
        member.selectedServiceIds,
      );
    const preparedAnswers = this.bookingAnswerValidationService.prepareAnswers(
      activeQuestions,
      member.answers,
    );

    return {
      member,
      memberOrder,
      selectedServices,
      preparedAnswers,
      requiredAnswersComplete:
        this.bookingAnswerValidationService.requiredAnswersComplete(
          activeQuestions,
          preparedAnswers,
        ),
      estimatedServiceMinutes: this.calculateEstimatedServiceMinutes(
        selectedServices,
        maximumEstimatedServiceMinutesPerPatient,
      ),
    };
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
    maximumEstimatedServiceMinutesPerPatient: number | null,
  ): number {
    const selectedServiceMinutes = selectedServices.reduce(
      (total, service) => total + service.durationMinutes,
      0,
    );

    return maximumEstimatedServiceMinutesPerPatient === null
      ? selectedServiceMinutes
      : Math.min(
          selectedServiceMinutes,
          maximumEstimatedServiceMinutesPerPatient,
        );
  }

  private isUniqueConflict(error: unknown): boolean {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    );
  }

  private readonly bookingDraftResultSelect = {
    id: true,
    bookingReference: true,
    mode: true,
    status: true,
    practiceLocationId: true,
    existingPatientResponse: true,
    serviceDate: true,
    estimatedServiceMinutes: true,
    expiresAt: true,
    createdAt: true,
  } satisfies Prisma.BookingDraftSelect;
}
