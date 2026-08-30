import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  BookingQuestionType,
  PracticeLocationLifecycleStatus,
  Prisma,
  Weekday,
} from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SaveDoctorClinicConfigurationDraftDto } from './dto/save-doctor-clinic-configuration-draft.dto';

@Injectable()
export class PracticeLocationConfigurationDraftService {
  constructor(private readonly prisma: PrismaService) {}

  async save(
    userId: string,
    practiceLocationId: string,
    dto: SaveDoctorClinicConfigurationDraftDto,
  ) {
    const doctorProfile = await this.prisma.doctorProfile.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!doctorProfile) {
      throw new ForbiddenException(
        'Only a doctor may save a clinic configuration draft.',
      );
    }

    this.validateSchedules(dto);
    this.validateServices(dto);
    this.validateQuestions(dto);

    return this.prisma.$transaction(
      async (transaction) => {
        const location = await transaction.practiceLocation.findFirst({
          where: {
            id: practiceLocationId,
            doctorProfileId: doctorProfile.id,
          },
          select: { id: true, lifecycleStatus: true },
        });
        if (
          !location ||
          location.lifecycleStatus ===
            PracticeLocationLifecycleStatus.PERMANENTLY_DELETED
        ) {
          throw new NotFoundException('Practice location not found.');
        }

        const basicInfo = this.normalizeBasicInfo(dto);
        await this.assertShortCodeAvailable(
          transaction,
          doctorProfile.id,
          practiceLocationId,
          basicInfo.shortCode,
        );

        if (
          location.lifecycleStatus === PracticeLocationLifecycleStatus.DRAFT
        ) {
          const existingQuestions = await transaction.bookingQuestion.findMany({
            where: { practiceLocationId },
            select: {
              id: true,
              helpText: true,
              estimatedMinutesAdjustment: true,
              textMaximumLength: true,
              numberMinimum: true,
              numberMaximum: true,
              selectOptions: true,
            },
          });
          const existingQuestionsById = new Map(
            existingQuestions.map((question) => [question.id, question]),
          );

          for (const question of dto.bookingQuestions) {
            if (
              question.effectiveBookingQuestionId &&
              !existingQuestionsById.has(question.effectiveBookingQuestionId)
            ) {
              throw new BadRequestException(
                'A BookingQuestion draft reference does not belong to this clinic.',
              );
            }
          }

          await transaction.practiceLocation.update({
            where: { id: practiceLocationId },
            data: basicInfo,
          });

          for (const row of this.scheduleRows(dto)) {
            const { weekday, ...data } = row;
            await transaction.practiceSchedule.upsert({
              where: {
                practiceLocationId_weekday: { practiceLocationId, weekday },
              },
              create: { practiceLocationId, weekday, ...data },
              update: data,
            });
          }

          await transaction.practiceLocationService.deleteMany({
            where: { practiceLocationId },
          });
          if (dto.services.length) {
            await transaction.practiceLocationService.createMany({
              data: dto.services.map((service) => ({
                practiceLocationId,
                sourceDoctorServiceTemplateId:
                  service.sourceDoctorServiceTemplateId ?? null,
                name: service.name.trim(),
                description: this.normalizeOptionalText(service.description),
                durationMinutes: service.durationMinutes,
                status: service.status,
              })),
            });
          }

          await transaction.bookingQuestion.deleteMany({
            where: { practiceLocationId },
          });
          if (dto.bookingQuestions.length) {
            await transaction.bookingQuestion.createMany({
              data: dto.bookingQuestions.map((question) => {
                const existing = question.effectiveBookingQuestionId
                  ? existingQuestionsById.get(
                      question.effectiveBookingQuestionId,
                    )
                  : undefined;
                return {
                  practiceLocationId,
                  questionText: question.questionText.trim(),
                  helpText: existing?.helpText ?? null,
                  type: question.type,
                  isRequired: question.isRequired,
                  displayOrder: question.displayOrder,
                  isActive: question.isActive,
                  estimatedMinutesAdjustment:
                    existing?.estimatedMinutesAdjustment ?? 0,
                  textMaximumLength: existing?.textMaximumLength ?? null,
                  numberMinimum: existing?.numberMinimum ?? null,
                  numberMaximum: existing?.numberMaximum ?? null,
                  selectOptions: this.selectOptionsJson(question),
                };
              }),
            });
          }

          return this.loadConfiguration(transaction, practiceLocationId);
        }

        const draft = await transaction.doctorPracticeScheduleDraft.upsert({
          where: { practiceLocationId },
          create: { practiceLocationId, ...basicInfo },
          update: basicInfo,
          select: { id: true },
        });

        await Promise.all([
          transaction.doctorPracticeScheduleDraftRow.deleteMany({
            where: { doctorPracticeScheduleDraftId: draft.id },
          }),
          transaction.doctorPracticeConfigurationDraftService.deleteMany({
            where: { doctorPracticeScheduleDraftId: draft.id },
          }),
          transaction.doctorPracticeConfigurationDraftBookingQuestion.deleteMany(
            { where: { doctorPracticeScheduleDraftId: draft.id } },
          ),
        ]);

        await transaction.doctorPracticeScheduleDraftRow.createMany({
          data: this.scheduleRows(dto).map((row) => ({
            doctorPracticeScheduleDraftId: draft.id,
            ...row,
          })),
        });
        if (dto.services.length) {
          await transaction.doctorPracticeConfigurationDraftService.createMany({
            data: dto.services.map((service) => ({
              doctorPracticeScheduleDraftId: draft.id,
              effectiveServiceId: service.effectiveServiceId ?? null,
              sourceDoctorServiceTemplateId:
                service.sourceDoctorServiceTemplateId ?? null,
              name: service.name.trim(),
              description: this.normalizeOptionalText(service.description),
              durationMinutes: service.durationMinutes,
              status: service.status,
            })),
          });
        }
        for (const question of dto.bookingQuestions) {
          const createdQuestion =
            await transaction.doctorPracticeConfigurationDraftBookingQuestion.create(
              {
                data: {
                  doctorPracticeScheduleDraftId: draft.id,
                  effectiveBookingQuestionId:
                    question.effectiveBookingQuestionId ?? null,
                  sourceDoctorBookingQuestionTemplateId:
                    question.sourceDoctorBookingQuestionTemplateId ?? null,
                  questionText: question.questionText.trim(),
                  type: question.type,
                  isRequired: question.isRequired,
                  displayOrder: question.displayOrder,
                  isActive: question.isActive,
                },
                select: { id: true },
              },
            );
          const options = this.normalizedSelectOptions(question);
          if (options.length) {
            await transaction.doctorPracticeConfigurationDraftBookingQuestionOption.createMany(
              {
                data: options.map((option, displayOrder) => ({
                  bookingQuestionDraftId: createdQuestion.id,
                  optionValue: option.value,
                  optionLabel: option.label,
                  displayOrder,
                })),
              },
            );
          }
        }

        return this.loadConfiguration(transaction, practiceLocationId);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  private async assertShortCodeAvailable(
    transaction: Prisma.TransactionClient,
    doctorProfileId: string,
    practiceLocationId: string,
    shortCode: string | null,
  ) {
    if (!shortCode) return;
    const duplicate = await transaction.practiceLocation.findFirst({
      where: {
        doctorProfileId,
        id: { not: practiceLocationId },
        lifecycleStatus: {
          not: PracticeLocationLifecycleStatus.PERMANENTLY_DELETED,
        },
        shortCode: { equals: shortCode, mode: 'insensitive' },
      },
      select: { id: true },
    });
    if (duplicate) {
      throw new ConflictException(
        'Another clinic already uses this short code.',
      );
    }
  }

  private normalizeBasicInfo(dto: SaveDoctorClinicConfigurationDraftDto) {
    const info = dto.basicInfo;
    return {
      name: this.normalizeOptionalText(info.name),
      shortCode:
        this.normalizeOptionalText(info.shortCode)?.toUpperCase() ?? null,
      addressLine1: this.normalizeOptionalText(info.addressLine1),
      addressLine2: this.normalizeOptionalText(info.addressLine2),
      cityMunicipality: this.normalizeOptionalText(info.cityMunicipality),
      province: this.normalizeOptionalText(info.province),
      postalCode: this.normalizeOptionalText(info.postalCode),
      contactNumber: this.normalizeOptionalText(info.contactNumber),
      clinicEmail:
        this.normalizeOptionalText(info.clinicEmail)?.toLowerCase() ?? null,
      clinicDescription: this.normalizeOptionalText(info.clinicDescription),
      countryCode:
        this.normalizeOptionalText(info.countryCode)?.toUpperCase() ?? null,
      timeZone: this.normalizeOptionalText(info.timeZone),
    };
  }

  private scheduleRows(dto: SaveDoctorClinicConfigurationDraftDto) {
    return dto.schedules.map((row) => ({
      weekday: row.weekday,
      isOpen: row.isOpen,
      opensAtLocal: row.isOpen ? this.localTime(row.opensAtLocal!) : null,
      closesAtLocal: row.isOpen ? this.localTime(row.closesAtLocal!) : null,
      maximumOnlineBookingUntilLocal:
        row.isOpen && row.maximumOnlineBookingUntilLocal
          ? this.localTime(row.maximumOnlineBookingUntilLocal)
          : null,
      maximumOperatingUntilLocal:
        row.isOpen && row.maximumOperatingUntilLocal
          ? this.localTime(row.maximumOperatingUntilLocal)
          : null,
    }));
  }

  private validateSchedules(dto: SaveDoctorClinicConfigurationDraftDto) {
    const weekdays = new Set(dto.schedules.map((row) => row.weekday));
    if (
      weekdays.size !== Object.values(Weekday).length ||
      Object.values(Weekday).some((weekday) => !weekdays.has(weekday))
    ) {
      throw new BadRequestException(
        'Clinic hours must contain each weekday exactly once.',
      );
    }
    for (const row of dto.schedules) {
      if (!row.isOpen) continue;
      if (!row.opensAtLocal || !row.closesAtLocal) {
        throw new BadRequestException(
          `Opening and closing times are required for ${row.weekday.toLowerCase()}.`,
        );
      }
      const opens = this.minutes(row.opensAtLocal);
      const closes = this.minutes(row.closesAtLocal);
      if (opens >= closes) {
        throw new BadRequestException(
          `Closing time must be later than opening time for ${row.weekday.toLowerCase()}.`,
        );
      }
      if (row.maximumOnlineBookingUntilLocal) {
        const cutoff = this.minutes(row.maximumOnlineBookingUntilLocal);
        if (cutoff < opens || cutoff > closes) {
          throw new BadRequestException(
            `Online booking cutoff must fall within clinic hours for ${row.weekday.toLowerCase()}.`,
          );
        }
      }
      if (
        row.maximumOperatingUntilLocal &&
        this.minutes(row.maximumOperatingUntilLocal) < closes
      ) {
        throw new BadRequestException(
          `Maximum operating time cannot be earlier than closing time for ${row.weekday.toLowerCase()}.`,
        );
      }
    }
  }

  private validateServices(dto: SaveDoctorClinicConfigurationDraftDto) {
    const names = new Set<string>();
    const effectiveIds = new Set<string>();
    for (const service of dto.services) {
      const name = service.name.trim();
      if (!name) throw new BadRequestException('Service name is required.');
      const key = name.toLocaleLowerCase();
      if (names.has(key)) {
        throw new BadRequestException(
          'Service names must be unique within a clinic.',
        );
      }
      names.add(key);
      if (service.effectiveServiceId) {
        if (effectiveIds.has(service.effectiveServiceId)) {
          throw new BadRequestException(
            'The same effective Service cannot appear twice in one clinic draft.',
          );
        }
        effectiveIds.add(service.effectiveServiceId);
      }
    }
  }

  private validateQuestions(dto: SaveDoctorClinicConfigurationDraftDto) {
    const orders = new Set<number>();
    const effectiveIds = new Set<string>();
    const activeCount = dto.bookingQuestions.filter(
      (question) => question.isActive,
    ).length;
    if (activeCount > 5) {
      throw new BadRequestException(
        'A clinic may have no more than 5 active BookingQuestions.',
      );
    }

    for (const question of dto.bookingQuestions) {
      if (!question.questionText.trim()) {
        throw new BadRequestException('Booking question text is required.');
      }
      if (orders.has(question.displayOrder)) {
        throw new BadRequestException(
          'Booking question display order must be unique within a clinic.',
        );
      }
      orders.add(question.displayOrder);
      if (question.effectiveBookingQuestionId) {
        if (effectiveIds.has(question.effectiveBookingQuestionId)) {
          throw new BadRequestException(
            'The same effective BookingQuestion cannot appear twice in one clinic draft.',
          );
        }
        effectiveIds.add(question.effectiveBookingQuestionId);
      }

      if (question.type === BookingQuestionType.SINGLE_SELECT) {
        const options = question.selectOptions ?? [];
        if (options.length < 2) {
          throw new BadRequestException(
            'Single Choice BookingQuestions require at least 2 options.',
          );
        }
        const values = new Set<string>();
        for (const option of options) {
          const value = option.value.trim();
          const label = option.label.trim();
          if (!value || !label) {
            throw new BadRequestException(
              'Single Choice option values and labels must not be blank.',
            );
          }
          if (values.has(value)) {
            throw new BadRequestException(
              'Single Choice option values must be unique within the question.',
            );
          }
          values.add(value);
        }
      } else if (question.selectOptions?.length) {
        throw new BadRequestException(
          'Select options are allowed only for Single Choice BookingQuestions.',
        );
      }
    }
  }

  private normalizedSelectOptions(
    question: SaveDoctorClinicConfigurationDraftDto['bookingQuestions'][number],
  ) {
    if (question.type !== BookingQuestionType.SINGLE_SELECT) return [];
    return (question.selectOptions ?? []).map((option) => ({
      value: option.value.trim(),
      label: option.label.trim(),
    }));
  }

  private selectOptionsJson(
    question: SaveDoctorClinicConfigurationDraftDto['bookingQuestions'][number],
  ): Prisma.InputJsonValue | typeof Prisma.JsonNull {
    const options = this.normalizedSelectOptions(question);
    return options.length ? options : Prisma.JsonNull;
  }

  private async loadConfiguration(
    transaction: Prisma.TransactionClient,
    practiceLocationId: string,
  ) {
    const configuration = await transaction.practiceLocation.findUniqueOrThrow({
      where: { id: practiceLocationId },
      select: {
        id: true,
        lifecycleStatus: true,
        name: true,
        shortCode: true,
        addressLine1: true,
        addressLine2: true,
        cityMunicipality: true,
        province: true,
        postalCode: true,
        contactNumber: true,
        clinicEmail: true,
        clinicDescription: true,
        countryCode: true,
        timeZone: true,
        services: { orderBy: [{ name: 'asc' }, { id: 'asc' }] },
        bookingQuestions: {
          orderBy: [{ displayOrder: 'asc' }, { id: 'asc' }],
        },
        practiceSchedules: { orderBy: { weekday: 'asc' } },
        doctorScheduleDraft: {
          include: {
            schedules: { orderBy: { weekday: 'asc' } },
            services: { orderBy: [{ name: 'asc' }, { id: 'asc' }] },
            bookingQuestions: {
              orderBy: [{ displayOrder: 'asc' }, { id: 'asc' }],
            },
          },
        },
      },
    });

    const draftQuestions = configuration.doctorScheduleDraft?.bookingQuestions;
    if (!draftQuestions?.length) return configuration;

    const optionRows =
      await transaction.doctorPracticeConfigurationDraftBookingQuestionOption.findMany(
        {
          where: {
            bookingQuestionDraftId: {
              in: draftQuestions.map((question) => question.id),
            },
          },
          orderBy: [{ bookingQuestionDraftId: 'asc' }, { displayOrder: 'asc' }],
        },
      );
    const optionsByQuestionId = new Map<
      string,
      Array<{ value: string; label: string }>
    >();
    for (const option of optionRows) {
      const current =
        optionsByQuestionId.get(option.bookingQuestionDraftId) ?? [];
      current.push({ value: option.optionValue, label: option.optionLabel });
      optionsByQuestionId.set(option.bookingQuestionDraftId, current);
    }

    return {
      ...configuration,
      doctorScheduleDraft: {
        ...configuration.doctorScheduleDraft,
        bookingQuestions: draftQuestions.map((question) => ({
          ...question,
          selectOptions:
            question.type === BookingQuestionType.SINGLE_SELECT
              ? (optionsByQuestionId.get(question.id) ?? [])
              : null,
        })),
      },
    };
  }

  private normalizeOptionalText(value: string | undefined): string | null {
    const normalized = value?.trim();
    return normalized ? normalized : null;
  }

  private minutes(value: string): number {
    const [hours, minutes] = value.split(':').map(Number);
    return hours * 60 + minutes;
  }

  private localTime(value: string): Date {
    const [hours, minutes] = value.split(':').map(Number);
    return new Date(Date.UTC(1970, 0, 1, hours, minutes, 0, 0));
  }
}
