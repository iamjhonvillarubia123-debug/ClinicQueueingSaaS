import { createHash } from 'crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  AdministrativeRestrictionStatus,
  BookingQuestionType,
  CommandType,
  PracticeLocationLifecycleStatus,
  Prisma,
  UserAccountStatus,
  UserRole,
} from '../../generated/prisma/client';
import { PasswordSecurityService } from '../auth/security/password-security.service';
import { PrismaService } from '../prisma/prisma.service';
import { RecurringScheduleConflictService } from '../schedule/recurring-schedule-conflict.service';
import { ScheduleTimeService } from '../schedule/schedule-time.service';
import { ApplyPracticeLocationConfigurationDraftDto } from './dto/apply-practice-location-configuration-draft.dto';

const IDEMPOTENCY_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

type TransactionClient = Prisma.TransactionClient;

type LockedLocation = {
  id: string;
  doctorProfileId: string;
  doctorUserId: string;
  lifecycleStatus: PracticeLocationLifecycleStatus;
};

@Injectable()
export class PracticeLocationConfigurationApplyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwordSecurityService: PasswordSecurityService,
    private readonly recurringScheduleConflict: RecurringScheduleConflictService,
    private readonly scheduleTime: ScheduleTimeService,
  ) {}

  async apply(
    authenticatedUserId: string,
    dto: ApplyPracticeLocationConfigurationDraftDto,
    idempotencyKey: string,
  ) {
    if (!dto.confirmApply) {
      throw new BadRequestException('Apply Changes must be confirmed.');
    }

    const key = this.normalizeIdempotencyKey(idempotencyKey);
    const commandType = CommandType.PRACTICE_LOCATION_UPDATE_SETTINGS;
    const commandIdentityKey = this.hash(
      `${commandType}|${authenticatedUserId}|${dto.practiceLocationId}|${key}`,
    );
    const requestFingerprint = this.hash(
      `${commandType}|${authenticatedUserId}|${dto.practiceLocationId}|confirmed`,
    );

    return this.prisma.$transaction(
      async (transaction) => {
        await this.acquireCommandLock(transaction, commandIdentityKey);
        const location = await this.lockPracticeLocation(
          transaction,
          dto.practiceLocationId,
        );
        await this.lockUser(transaction, authenticatedUserId);
        await this.acquireDoctorScheduleLock(
          transaction,
          location.doctorProfileId,
        );

        const actor = await transaction.user.findUnique({
          where: { id: authenticatedUserId },
          select: {
            role: true,
            accountStatus: true,
            administrativeRestrictionStatus: true,
            passwordHash: true,
          },
        });
        this.assertOwningDoctor(actor, authenticatedUserId, location);

        const replay = await transaction.commandIdempotency.findUnique({
          where: { commandIdentityKey },
          select: { id: true, requestFingerprint: true },
        });
        if (replay) {
          this.assertCompatibleReplay(
            replay.requestFingerprint,
            requestFingerprint,
          );
          return { applied: true, replayed: true };
        }

        if (
          location.lifecycleStatus !== PracticeLocationLifecycleStatus.ACTIVE &&
          location.lifecycleStatus !== PracticeLocationLifecycleStatus.DISABLED
        ) {
          throw new ConflictException(
            'Apply Changes is available only for active or disabled practice locations.',
          );
        }

        if (
          !actor?.passwordHash ||
          !(await this.passwordSecurityService.verify(
            dto.password,
            actor.passwordHash,
          ))
        ) {
          throw new UnauthorizedException('Current password is invalid.');
        }

        const draft = await transaction.doctorPracticeScheduleDraft.findUnique({
          where: { practiceLocationId: location.id },
          include: {
            schedules: { orderBy: { weekday: 'asc' } },
            services: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
            bookingQuestions: {
              orderBy: [{ displayOrder: 'asc' }, { id: 'asc' }],
            },
          },
        });
        if (!draft) {
          throw new ConflictException(
            'There are no proposed clinic changes to apply.',
          );
        }

        const optionRows = draft.bookingQuestions.length
          ? await transaction.doctorPracticeConfigurationDraftBookingQuestionOption.findMany(
              {
                where: {
                  bookingQuestionDraftId: {
                    in: draft.bookingQuestions.map((question) => question.id),
                  },
                },
                orderBy: [
                  { bookingQuestionDraftId: 'asc' },
                  { displayOrder: 'asc' },
                ],
              },
            )
          : [];
        const optionsByQuestion = new Map<string, typeof optionRows>();
        for (const option of optionRows) {
          const current =
            optionsByQuestion.get(option.bookingQuestionDraftId) ?? [];
          current.push(option);
          optionsByQuestion.set(option.bookingQuestionDraftId, current);
        }

        this.validateCompleteDraft(draft, optionsByQuestion);
        await this.assertShortCodeAvailable(
          transaction,
          location.doctorProfileId,
          location.id,
          draft.shortCode,
        );
        await this.assertQuestionHistoryCompatible(
          transaction,
          location.id,
          draft.bookingQuestions,
          optionsByQuestion,
        );

        await transaction.practiceLocation.update({
          where: { id: location.id },
          data: {
            name: draft.name,
            shortCode: draft.shortCode,
            addressLine1: draft.addressLine1,
            addressLine2: draft.addressLine2,
            cityMunicipality: draft.cityMunicipality,
            province: draft.province,
            postalCode: draft.postalCode,
            contactNumber: draft.contactNumber,
            clinicEmail: draft.clinicEmail,
            clinicDescription: draft.clinicDescription,
            countryCode: draft.countryCode,
            timeZone: draft.timeZone,
          },
        });

        for (const schedule of draft.schedules) {
          await transaction.practiceSchedule.upsert({
            where: {
              practiceLocationId_weekday: {
                practiceLocationId: location.id,
                weekday: schedule.weekday,
              },
            },
            create: {
              practiceLocationId: location.id,
              weekday: schedule.weekday,
              isOpen: schedule.isOpen,
              opensAtLocal: schedule.opensAtLocal,
              closesAtLocal: schedule.closesAtLocal,
              maximumOnlineBookingUntilLocal:
                schedule.maximumOnlineBookingUntilLocal,
              maximumOperatingUntilLocal: schedule.maximumOperatingUntilLocal,
            },
            update: {
              isOpen: schedule.isOpen,
              opensAtLocal: schedule.opensAtLocal,
              closesAtLocal: schedule.closesAtLocal,
              maximumOnlineBookingUntilLocal:
                schedule.maximumOnlineBookingUntilLocal,
              maximumOperatingUntilLocal: schedule.maximumOperatingUntilLocal,
            },
          });
        }

        const effectiveServices =
          await transaction.practiceLocationService.findMany({
            where: { practiceLocationId: location.id },
            select: { id: true },
          });
        const retainedServiceIds = new Set<string>();
        for (const service of draft.services) {
          if (service.effectiveServiceId) {
            const belongs = effectiveServices.some(
              (effective) => effective.id === service.effectiveServiceId,
            );
            if (!belongs) {
              throw new ConflictException(
                'A proposed Service no longer belongs to this practice location.',
              );
            }
            retainedServiceIds.add(service.effectiveServiceId);
            await transaction.practiceLocationService.update({
              where: { id: service.effectiveServiceId },
              data: {
                sourceDoctorServiceTemplateId:
                  service.sourceDoctorServiceTemplateId,
                name: service.name,
                description: service.description,
                durationMinutes: service.durationMinutes,
                status: service.status,
              },
            });
          } else {
            await transaction.practiceLocationService.create({
              data: {
                practiceLocationId: location.id,
                sourceDoctorServiceTemplateId:
                  service.sourceDoctorServiceTemplateId,
                name: service.name,
                description: service.description,
                durationMinutes: service.durationMinutes,
                status: service.status,
              },
            });
          }
        }
        const removedServiceIds = effectiveServices
          .map((service) => service.id)
          .filter((id) => !retainedServiceIds.has(id));
        if (removedServiceIds.length) {
          await transaction.practiceLocationService.updateMany({
            where: { id: { in: removedServiceIds } },
            data: { status: 'INACTIVE' },
          });
        }

        const effectiveQuestions = await transaction.bookingQuestion.findMany({
          where: { practiceLocationId: location.id },
          select: {
            id: true,
            helpText: true,
            estimatedMinutesAdjustment: true,
            textMaximumLength: true,
            numberMinimum: true,
            numberMaximum: true,
          },
        });
        const effectiveQuestionsById = new Map(
          effectiveQuestions.map((question) => [question.id, question]),
        );
        const retainedQuestionIds = new Set<string>();
        for (const question of draft.bookingQuestions) {
          const options = optionsByQuestion.get(question.id) ?? [];
          const selectOptions =
            question.type === BookingQuestionType.SINGLE_SELECT
              ? options.map((option) => ({
                  value: option.optionValue,
                  label: option.optionLabel,
                }))
              : Prisma.JsonNull;
          if (question.effectiveBookingQuestionId) {
            const existing = effectiveQuestionsById.get(
              question.effectiveBookingQuestionId,
            );
            if (!existing) {
              throw new ConflictException(
                'A proposed BookingQuestion no longer belongs to this practice location.',
              );
            }
            retainedQuestionIds.add(question.effectiveBookingQuestionId);
            await transaction.bookingQuestion.update({
              where: { id: question.effectiveBookingQuestionId },
              data: {
                questionText: question.questionText,
                type: question.type,
                isRequired: question.isRequired,
                displayOrder: question.displayOrder,
                isActive: question.isActive,
                selectOptions,
              },
            });
          } else {
            await transaction.bookingQuestion.create({
              data: {
                practiceLocationId: location.id,
                questionText: question.questionText,
                helpText: null,
                type: question.type,
                isRequired: question.isRequired,
                displayOrder: question.displayOrder,
                isActive: question.isActive,
                estimatedMinutesAdjustment: 0,
                textMaximumLength: null,
                numberMinimum: null,
                numberMaximum: null,
                selectOptions,
              },
            });
          }
        }
        const removedQuestionIds = effectiveQuestions
          .map((question) => question.id)
          .filter((id) => !retainedQuestionIds.has(id));
        if (removedQuestionIds.length) {
          await transaction.bookingQuestion.updateMany({
            where: { id: { in: removedQuestionIds } },
            data: { isActive: false },
          });
        }

        const effectiveTimeZone = draft.timeZone?.trim();
        if (!effectiveTimeZone) {
          throw new ConflictException(
            'Practice location time zone is required.',
          );
        }
        this.scheduleTime.assertValidTimeZone(effectiveTimeZone);
        if (
          location.lifecycleStatus === PracticeLocationLifecycleStatus.ACTIVE
        ) {
          await this.recurringScheduleConflict.assertNoConflictForLocation(
            location.doctorProfileId,
            location.id,
            effectiveTimeZone,
            transaction,
          );
        }

        const now = new Date();
        const command = await transaction.commandIdempotency.create({
          data: {
            idempotencyKey: key,
            commandIdentityKey,
            commandType,
            requestFingerprint,
            practiceLocationId: location.id,
            actorUserId: authenticatedUserId,
            completedAt: now,
            expiresAt: new Date(now.getTime() + IDEMPOTENCY_RETENTION_MS),
            createdAt: now,
          },
          select: { id: true },
        });

        await transaction.$executeRaw(Prisma.sql`
          INSERT INTO "PracticeLocationConfigurationAudit" (
            "practiceLocationId",
            "actorUserId",
            "commandIdempotencyId",
            "actionType",
            "changedSections",
            "occurredAt"
          ) VALUES (
            ${location.id}::uuid,
            ${authenticatedUserId}::uuid,
            ${command.id}::uuid,
            'UPDATE_SETTINGS',
            ${JSON.stringify([
              'BASIC_INFORMATION',
              'CLINIC_HOURS',
              'SERVICES',
              'BOOKING_QUESTIONS',
            ])}::jsonb,
            ${now}
          )
        `);

        await transaction.doctorPracticeScheduleDraft.delete({
          where: { id: draft.id },
        });

        return { applied: true, replayed: false };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  private validateCompleteDraft(
    draft: {
      name: string | null;
      addressLine1: string | null;
      countryCode: string | null;
      timeZone: string | null;
      schedules: Array<{
        isOpen: boolean;
        opensAtLocal: Date | null;
        closesAtLocal: Date | null;
        maximumOnlineBookingUntilLocal: Date | null;
        maximumOperatingUntilLocal: Date | null;
      }>;
      services: Array<{
        name: string;
        durationMinutes: number;
      }>;
      bookingQuestions: Array<{
        id: string;
        questionText: string;
        type: BookingQuestionType;
        displayOrder: number;
        isActive: boolean;
      }>;
    },
    optionsByQuestion: Map<
      string,
      Array<{ optionValue: string; optionLabel: string }>
    >,
  ) {
    if (
      !draft.name?.trim() ||
      !draft.addressLine1?.trim() ||
      !draft.countryCode?.trim() ||
      !draft.timeZone?.trim()
    ) {
      throw new ConflictException(
        'Basic clinic information is incomplete. Correct the draft before applying it.',
      );
    }
    if (draft.schedules.length !== 7) {
      throw new ConflictException(
        'Clinic hours must contain all seven weekdays before applying changes.',
      );
    }
    const open = draft.schedules.filter((schedule) => schedule.isOpen);
    if (!open.length) {
      throw new ConflictException(
        'At least one open recurring clinic-hours schedule is required.',
      );
    }
    for (const schedule of draft.schedules) {
      if (schedule.isOpen) {
        if (!schedule.opensAtLocal || !schedule.closesAtLocal) {
          throw new ConflictException(
            'Every open recurring clinic schedule requires opening and closing times.',
          );
        }
        if (schedule.closesAtLocal <= schedule.opensAtLocal) {
          throw new ConflictException(
            'Every open recurring clinic schedule must close after opening.',
          );
        }
        if (
          schedule.maximumOperatingUntilLocal &&
          schedule.maximumOperatingUntilLocal < schedule.closesAtLocal
        ) {
          throw new ConflictException(
            'Maximum operating time cannot be earlier than clinic closing time.',
          );
        }
      }
    }
    const serviceNames = new Set<string>();
    for (const service of draft.services) {
      if (
        !service.name.trim() ||
        service.durationMinutes <= 0 ||
        service.durationMinutes > 1440
      ) {
        throw new ConflictException('A proposed Service is invalid.');
      }
      const name = service.name.trim().toLowerCase();
      if (serviceNames.has(name)) {
        throw new ConflictException(
          'Service names must be unique within a clinic.',
        );
      }
      serviceNames.add(name);
    }
    const activeQuestions = draft.bookingQuestions.filter(
      (question) => question.isActive,
    );
    if (activeQuestions.length > 5) {
      throw new ConflictException(
        'A clinic may have no more than 5 active BookingQuestions.',
      );
    }
    const orders = new Set<number>();
    for (const question of draft.bookingQuestions) {
      if (!question.questionText.trim() || question.displayOrder < 0) {
        throw new ConflictException('A proposed BookingQuestion is invalid.');
      }
      if (orders.has(question.displayOrder)) {
        throw new ConflictException(
          'Booking question display order must be unique within a clinic.',
        );
      }
      orders.add(question.displayOrder);
      const options = optionsByQuestion.get(question.id) ?? [];
      if (question.type === BookingQuestionType.SINGLE_SELECT) {
        if (options.length < 2) {
          throw new ConflictException(
            'Single Choice BookingQuestions require at least 2 options.',
          );
        }
        const values = new Set<string>();
        for (const option of options) {
          const value = option.optionValue.trim();
          if (!value || !option.optionLabel.trim() || values.has(value)) {
            throw new ConflictException(
              'Single Choice BookingQuestion options are invalid.',
            );
          }
          values.add(value);
        }
      } else if (options.length) {
        throw new ConflictException(
          'Only Single Choice BookingQuestions may have options.',
        );
      }
    }
  }

  private async assertQuestionHistoryCompatible(
    transaction: TransactionClient,
    practiceLocationId: string,
    questions: Array<{
      id: string;
      effectiveBookingQuestionId: string | null;
      questionText: string;
      type: BookingQuestionType;
    }>,
    optionsByQuestion: Map<
      string,
      Array<{ optionValue: string; optionLabel: string }>
    >,
  ) {
    for (const question of questions) {
      if (!question.effectiveBookingQuestionId) continue;
      const existing = await transaction.bookingQuestion.findFirst({
        where: {
          id: question.effectiveBookingQuestionId,
          practiceLocationId,
        },
        select: {
          questionText: true,
          type: true,
          selectOptions: true,
          _count: {
            select: { appointmentAnswers: true, bookingDraftAnswers: true },
          },
        },
      });
      if (!existing) {
        throw new ConflictException(
          'A proposed BookingQuestion no longer belongs to this practice location.',
        );
      }
      if (
        existing._count.appointmentAnswers === 0 &&
        existing._count.bookingDraftAnswers === 0
      ) {
        continue;
      }
      const proposedValues =
        question.type === BookingQuestionType.SINGLE_SELECT
          ? (optionsByQuestion.get(question.id) ?? []).map(
              (option) => option.optionValue,
            )
          : [];
      const existingValues = Array.isArray(existing.selectOptions)
        ? existing.selectOptions.flatMap((option) => {
            if (
              !option ||
              typeof option !== 'object' ||
              Array.isArray(option)
            ) {
              return [];
            }
            const value = (option as { value?: unknown }).value;
            return typeof value === 'string' ? [value] : [];
          })
        : [];
      if (
        existing.questionText !== question.questionText ||
        existing.type !== question.type ||
        existingValues.join('\u0000') !== proposedValues.join('\u0000')
      ) {
        throw new ConflictException(
          'A BookingQuestion with historical answers cannot change its text, type, or existing option values. Deactivate it and create a replacement question instead.',
        );
      }
    }
  }

  private async assertShortCodeAvailable(
    transaction: TransactionClient,
    doctorProfileId: string,
    practiceLocationId: string,
    shortCode: string | null,
  ) {
    const normalized = shortCode?.trim();
    if (!normalized) return;
    const duplicate = await transaction.practiceLocation.findFirst({
      where: {
        id: { not: practiceLocationId },
        doctorProfileId,
        lifecycleStatus: {
          not: PracticeLocationLifecycleStatus.PERMANENTLY_DELETED,
        },
        shortCode: { equals: normalized, mode: 'insensitive' },
      },
      select: { id: true },
    });
    if (duplicate) {
      throw new ConflictException(
        'Another clinic already uses this short code.',
      );
    }
  }

  private async lockPracticeLocation(
    transaction: TransactionClient,
    practiceLocationId: string,
  ): Promise<LockedLocation> {
    const rows = await transaction.$queryRaw<LockedLocation[]>(Prisma.sql`
      SELECT
        pl."id",
        pl."doctorProfileId",
        pl."lifecycleStatus",
        dp."userId" AS "doctorUserId"
      FROM "PracticeLocation" pl
      INNER JOIN "DoctorProfile" dp ON dp."id" = pl."doctorProfileId"
      WHERE pl."id" = ${practiceLocationId}
      LIMIT 1
      FOR UPDATE OF pl
    `);
    const location = rows[0];
    if (!location) {
      throw new NotFoundException('Practice location was not found.');
    }
    return location;
  }

  private assertOwningDoctor(
    actor: {
      role: UserRole;
      accountStatus: UserAccountStatus;
      administrativeRestrictionStatus: AdministrativeRestrictionStatus;
      passwordHash: string;
    } | null,
    authenticatedUserId: string,
    location: LockedLocation,
  ) {
    if (
      !actor ||
      actor.role !== UserRole.DOCTOR ||
      actor.accountStatus !== UserAccountStatus.ACTIVE ||
      actor.administrativeRestrictionStatus !==
        AdministrativeRestrictionStatus.NONE ||
      location.doctorUserId !== authenticatedUserId
    ) {
      throw new ForbiddenException(
        'Only the eligible owning doctor may apply clinic configuration changes.',
      );
    }
  }

  private async acquireCommandLock(
    transaction: TransactionClient,
    commandIdentityKey: string,
  ) {
    await transaction.$executeRaw(Prisma.sql`
      SELECT pg_advisory_xact_lock(hashtextextended(${commandIdentityKey}, 0))
    `);
  }

  private async acquireDoctorScheduleLock(
    transaction: TransactionClient,
    doctorProfileId: string,
  ) {
    const scope = `DOCTOR_SCHEDULE|${doctorProfileId}`;
    await transaction.$executeRaw(Prisma.sql`
      SELECT pg_advisory_xact_lock(hashtextextended(${scope}, 0))
    `);
  }

  private async lockUser(transaction: TransactionClient, userId: string) {
    await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id" FROM "User" WHERE "id" = ${userId} LIMIT 1 FOR UPDATE
    `);
  }

  private normalizeIdempotencyKey(value: string) {
    const normalized = value?.trim();
    if (!normalized) {
      throw new BadRequestException('Idempotency-Key header is required.');
    }
    if (normalized.length > 100) {
      throw new BadRequestException('Idempotency-Key is too long.');
    }
    return normalized;
  }

  private assertCompatibleReplay(stored: string, current: string) {
    if (stored !== current) {
      throw new ConflictException(
        'Idempotency-Key was already used for a different request.',
      );
    }
  }

  private hash(value: string) {
    return createHash('sha256').update(value, 'utf8').digest('hex');
  }
}
