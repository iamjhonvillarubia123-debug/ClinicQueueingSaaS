import { createHash } from 'crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AdministrativeRestrictionStatus,
  CommandType,
  PracticeLocationLifecycleStatus,
  Prisma,
  SecretarySettingsDraftStatus,
  UserAccountStatus,
  UserRole,
  Weekday,
} from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CrossLocationScheduleConflictService } from '../schedule/cross-location-schedule-conflict.service';
import { DoctorCalendarAvailabilityService } from '../schedule/doctor-calendar-availability.service';
import { RecurringScheduleConflictService } from '../schedule/recurring-schedule-conflict.service';
import { ScheduleResolutionService } from '../schedule/schedule-resolution.service';

const IDEMPOTENCY_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_ACTIVE_BOOKING_QUESTIONS = 5;

type TransactionClient = Prisma.TransactionClient;

type LockedApprovalDraft = {
  id: string;
  practiceLocationId: string;
  status: SecretarySettingsDraftStatus;
  lifecycleStatus: PracticeLocationLifecycleStatus;
  doctorProfileId: string;
  doctorUserId: string;
  timeZone: string | null;
};

type ApprovalActor = {
  role: UserRole;
  accountStatus: UserAccountStatus;
  administrativeRestrictionStatus: AdministrativeRestrictionStatus;
} | null;

@Injectable()
export class SecretarySettingsDraftApprovalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scheduleResolution: ScheduleResolutionService,
    private readonly doctorCalendar: DoctorCalendarAvailabilityService,
    private readonly crossLocationConflict: CrossLocationScheduleConflictService,
    private readonly recurringScheduleConflict: RecurringScheduleConflictService,
  ) {}

  async approve(
    authenticatedUserId: string,
    draftId: string,
    idempotencyKey: string,
  ) {
    const key = this.normalizeIdempotencyKey(idempotencyKey);
    const commandType = CommandType.PRACTICE_LOCATION_APPROVE_SETTINGS_DRAFT;
    const commandIdentityKey = this.hash(
      `${commandType}|${authenticatedUserId}|${draftId}|${key}`,
    );
    const requestFingerprint = this.hash(
      `${commandType}|${authenticatedUserId}|${draftId}`,
    );

    return this.prisma.$transaction(async (transaction) => {
      await this.acquireCommandLock(transaction, commandIdentityKey);
      const draft = await this.lockApprovalDraft(transaction, draftId);
      await this.acquireDoctorScheduleLock(transaction, draft.doctorProfileId);
      await this.lockUser(transaction, authenticatedUserId);

      const actor = await transaction.user.findUnique({
        where: { id: authenticatedUserId },
        select: {
          role: true,
          accountStatus: true,
          administrativeRestrictionStatus: true,
        },
      });
      this.assertOwningDoctor(actor, authenticatedUserId, draft);

      const replay = await transaction.commandIdempotency.findUnique({
        where: { commandIdentityKey },
      });
      if (replay) {
        this.assertCompatibleReplay(
          replay.requestFingerprint,
          requestFingerprint,
        );
        return {
          approved: true,
          replayed: true,
          draftId: draft.id,
          status: SecretarySettingsDraftStatus.APPROVED,
        };
      }

      if (draft.status !== SecretarySettingsDraftStatus.SUBMITTED) {
        throw new ConflictException(
          'Only a submitted settings draft may be approved.',
        );
      }
      if (
        draft.lifecycleStatus ===
        PracticeLocationLifecycleStatus.PERMANENTLY_DELETED
      ) {
        throw new ConflictException(
          'A permanently deleted practice location cannot receive settings changes.',
        );
      }

      const [
        clinicDetailsProposal,
        serviceProposals,
        scheduleProposals,
        exceptionProposals,
        questionProposals,
      ] = await Promise.all([
        transaction.secretarySettingsDraftClinicDetails.findUnique({
          where: { secretarySettingsDraftId: draft.id },
        }),
        transaction.secretarySettingsDraftService.findMany({
          where: { secretarySettingsDraftId: draft.id },
          orderBy: { id: 'asc' },
        }),
        transaction.secretarySettingsDraftPracticeSchedule.findMany({
          where: { secretarySettingsDraftId: draft.id },
          orderBy: { weekday: 'asc' },
        }),
        transaction.secretarySettingsDraftScheduleException.findMany({
          where: { secretarySettingsDraftId: draft.id },
          orderBy: { serviceDate: 'asc' },
        }),
        transaction.secretarySettingsDraftBookingQuestion.findMany({
          where: { secretarySettingsDraftId: draft.id },
          orderBy: { id: 'asc' },
        }),
      ]);

      await this.validateServiceTargets(
        transaction,
        draft.practiceLocationId,
        serviceProposals,
      );
      await this.validateBookingQuestionResult(
        transaction,
        draft.practiceLocationId,
        questionProposals,
      );

      if (clinicDetailsProposal) {
        await transaction.practiceLocation.update({
          where: { id: draft.practiceLocationId },
          data: {
            name: clinicDetailsProposal.proposedName,
            addressLine1: clinicDetailsProposal.proposedAddressLine1,
            addressLine2: clinicDetailsProposal.proposedAddressLine2,
            cityMunicipality: clinicDetailsProposal.proposedCityMunicipality,
            province: clinicDetailsProposal.proposedProvince,
            postalCode: clinicDetailsProposal.proposedPostalCode,
            contactNumber: clinicDetailsProposal.proposedContactNumber,
            countryCode: clinicDetailsProposal.proposedCountryCode,
            timeZone: clinicDetailsProposal.proposedTimeZone,
          },
        });
        draft.timeZone = clinicDetailsProposal.proposedTimeZone;
      }

      await this.applyServiceProposals(
        transaction,
        draft.practiceLocationId,
        serviceProposals,
      );
      await this.applyScheduleProposals(
        transaction,
        draft.practiceLocationId,
        scheduleProposals,
      );
      await this.applyExceptionProposals(
        transaction,
        draft.practiceLocationId,
        exceptionProposals,
      );
      await this.applyBookingQuestionProposals(
        transaction,
        draft.practiceLocationId,
        questionProposals,
      );

      if (draft.lifecycleStatus === PracticeLocationLifecycleStatus.ACTIVE) {
        await this.revalidateActiveSchedule(
          transaction,
          draft,
          exceptionProposals.map((proposal) => proposal.serviceDate),
        );
      }

      const now = new Date();
      await transaction.secretarySettingsDraft.update({
        where: { id: draft.id },
        data: {
          status: SecretarySettingsDraftStatus.APPROVED,
          reviewedAt: now,
          reviewedByUserId: authenticatedUserId,
          reviewComment: null,
        },
      });

      await transaction.commandIdempotency.create({
        data: {
          idempotencyKey: key,
          commandIdentityKey,
          commandType,
          requestFingerprint,
          practiceLocationId: draft.practiceLocationId,
          actorUserId: authenticatedUserId,
          completedAt: now,
          expiresAt: new Date(now.getTime() + IDEMPOTENCY_RETENTION_MS),
          createdAt: now,
        },
      });

      return {
        approved: true,
        replayed: false,
        draftId: draft.id,
        status: SecretarySettingsDraftStatus.APPROVED,
      };
    });
  }

  private async validateServiceTargets(
    transaction: TransactionClient,
    practiceLocationId: string,
    proposals: Array<{ practiceLocationServiceId: string | null }>,
  ): Promise<void> {
    const targetIds = proposals
      .map((proposal) => proposal.practiceLocationServiceId)
      .filter((value): value is string => Boolean(value));
    if (targetIds.length === 0) {
      return;
    }
    const existing = await transaction.practiceLocationService.findMany({
      where: { id: { in: targetIds }, practiceLocationId },
      select: { id: true },
    });
    if (existing.length !== new Set(targetIds).size) {
      throw new ConflictException(
        'A proposed Service no longer belongs to this practice location.',
      );
    }
  }

  private async validateBookingQuestionResult(
    transaction: TransactionClient,
    practiceLocationId: string,
    proposals: Array<{
      id: string;
      bookingQuestionId: string | null;
      proposedDisplayOrder: number;
      proposedIsActive: boolean;
    }>,
  ): Promise<void> {
    const current = await transaction.bookingQuestion.findMany({
      where: { practiceLocationId },
      select: { id: true, displayOrder: true, isActive: true },
      orderBy: { id: 'asc' },
    });
    const result = new Map(
      current.map((question) => [
        question.id,
        { displayOrder: question.displayOrder, isActive: question.isActive },
      ]),
    );

    for (const proposal of proposals) {
      if (proposal.bookingQuestionId) {
        if (!result.has(proposal.bookingQuestionId)) {
          throw new ConflictException(
            'A proposed BookingQuestion no longer belongs to this practice location.',
          );
        }
        result.set(proposal.bookingQuestionId, {
          displayOrder: proposal.proposedDisplayOrder,
          isActive: proposal.proposedIsActive,
        });
      } else {
        result.set(`proposal:${proposal.id}`, {
          displayOrder: proposal.proposedDisplayOrder,
          isActive: proposal.proposedIsActive,
        });
      }
    }

    const activeCount = [...result.values()].filter(
      (question) => question.isActive,
    ).length;
    if (activeCount > MAX_ACTIVE_BOOKING_QUESTIONS) {
      throw new ConflictException(
        'A practice location may have at most five active BookingQuestions.',
      );
    }

    const displayOrders = [...result.values()].map(
      (question) => question.displayOrder,
    );
    if (new Set(displayOrders).size !== displayOrders.length) {
      throw new ConflictException(
        'BookingQuestion display order must be unique within the practice location.',
      );
    }
  }

  private async applyServiceProposals(
    transaction: TransactionClient,
    practiceLocationId: string,
    proposals: Array<{
      practiceLocationServiceId: string | null;
      sourceDoctorServiceTemplateId: string | null;
      proposedName: string;
      proposedDurationMinutes: number;
      proposedStatus: Parameters<
        TransactionClient['practiceLocationService']['create']
      >[0]['data']['status'];
    }>,
  ): Promise<void> {
    for (const proposal of proposals) {
      const data = {
        name: proposal.proposedName,
        durationMinutes: proposal.proposedDurationMinutes,
        status: proposal.proposedStatus,
      };
      if (proposal.practiceLocationServiceId) {
        await transaction.practiceLocationService.update({
          where: { id: proposal.practiceLocationServiceId },
          data,
        });
      } else {
        await transaction.practiceLocationService.create({
          data: {
            practiceLocationId,
            sourceDoctorServiceTemplateId:
              proposal.sourceDoctorServiceTemplateId,
            ...data,
          },
        });
      }
    }
  }

  private async applyScheduleProposals(
    transaction: TransactionClient,
    practiceLocationId: string,
    proposals: Array<{
      weekday: Weekday;
      proposedIsOpen: boolean;
      proposedOpensAtLocal: Date | null;
      proposedClosesAtLocal: Date | null;
      proposedMaximumOnlineBookingUntilLocal: Date | null;
      proposedMaximumOperatingUntilLocal: Date | null;
    }>,
  ): Promise<void> {
    for (const proposal of proposals) {
      const data = {
        isOpen: proposal.proposedIsOpen,
        opensAtLocal: proposal.proposedOpensAtLocal,
        closesAtLocal: proposal.proposedClosesAtLocal,
        maximumOnlineBookingUntilLocal:
          proposal.proposedMaximumOnlineBookingUntilLocal,
        maximumOperatingUntilLocal: proposal.proposedMaximumOperatingUntilLocal,
      };
      await transaction.practiceSchedule.upsert({
        where: {
          practiceLocationId_weekday: {
            practiceLocationId,
            weekday: proposal.weekday,
          },
        },
        update: data,
        create: { practiceLocationId, weekday: proposal.weekday, ...data },
      });
    }
  }

  private async applyExceptionProposals(
    transaction: TransactionClient,
    practiceLocationId: string,
    proposals: Array<{
      serviceDate: Date;
      proposedIsOpen: boolean;
      proposedOpensAtLocal: Date | null;
      proposedClosesAtLocal: Date | null;
      proposedMaximumOnlineBookingUntilLocal: Date | null;
      proposedMaximumOperatingUntilLocal: Date | null;
    }>,
  ): Promise<void> {
    for (const proposal of proposals) {
      const data = {
        isOpen: proposal.proposedIsOpen,
        opensAtLocal: proposal.proposedOpensAtLocal,
        closesAtLocal: proposal.proposedClosesAtLocal,
        maximumOnlineBookingUntilLocal:
          proposal.proposedMaximumOnlineBookingUntilLocal,
        maximumOperatingUntilLocal: proposal.proposedMaximumOperatingUntilLocal,
      };
      await transaction.scheduleException.upsert({
        where: {
          practiceLocationId_serviceDate: {
            practiceLocationId,
            serviceDate: proposal.serviceDate,
          },
        },
        update: data,
        create: {
          practiceLocationId,
          serviceDate: proposal.serviceDate,
          ...data,
        },
      });
    }
  }

  private async applyBookingQuestionProposals(
    transaction: TransactionClient,
    practiceLocationId: string,
    proposals: Array<{
      bookingQuestionId: string | null;
      proposedQuestionText: string;
      proposedHelpText: string | null;
      proposedType: Parameters<
        TransactionClient['bookingQuestion']['create']
      >[0]['data']['type'];
      proposedIsRequired: boolean;
      proposedDisplayOrder: number;
      proposedIsActive: boolean;
      proposedEstimatedMinutesAdjustment: number;
      proposedTextMaximumLength: number | null;
      proposedNumberMinimum: Prisma.Decimal | null;
      proposedNumberMaximum: Prisma.Decimal | null;
      proposedSelectOptions: Prisma.JsonValue | null;
    }>,
  ): Promise<void> {
    const existing = proposals.filter(
      (proposal): proposal is typeof proposal & { bookingQuestionId: string } =>
        Boolean(proposal.bookingQuestionId),
    );
    if (existing.length > 0) {
      const currentMax = await transaction.bookingQuestion.aggregate({
        where: { practiceLocationId },
        _max: { displayOrder: true },
      });
      const temporaryBase = (currentMax._max.displayOrder ?? 0) + 1000;
      for (const [index, proposal] of existing.entries()) {
        await transaction.bookingQuestion.update({
          where: { id: proposal.bookingQuestionId },
          data: { displayOrder: temporaryBase + index },
        });
      }
    }

    for (const proposal of proposals) {
      const data = {
        questionText: proposal.proposedQuestionText,
        helpText: proposal.proposedHelpText,
        type: proposal.proposedType,
        isRequired: proposal.proposedIsRequired,
        displayOrder: proposal.proposedDisplayOrder,
        isActive: proposal.proposedIsActive,
        estimatedMinutesAdjustment: proposal.proposedEstimatedMinutesAdjustment,
        textMaximumLength: proposal.proposedTextMaximumLength,
        numberMinimum: proposal.proposedNumberMinimum,
        numberMaximum: proposal.proposedNumberMaximum,
        selectOptions:
          proposal.proposedSelectOptions === null
            ? Prisma.JsonNull
            : proposal.proposedSelectOptions,
      };
      if (proposal.bookingQuestionId) {
        await transaction.bookingQuestion.update({
          where: { id: proposal.bookingQuestionId },
          data,
        });
      } else {
        await transaction.bookingQuestion.create({
          data: { practiceLocationId, ...data },
        });
      }
    }
  }

  private async revalidateActiveSchedule(
    transaction: TransactionClient,
    draft: LockedApprovalDraft,
    proposedExceptionDates: Date[],
  ): Promise<void> {
    const timeZone = draft.timeZone?.trim();
    if (!timeZone) {
      throw new ConflictException(
        'An active practice location requires a configured time zone.',
      );
    }

    await this.recurringScheduleConflict.assertNoConflictForLocation(
      draft.doctorProfileId,
      draft.practiceLocationId,
      timeZone,
      transaction,
    );

    const dates = new Set<string>();
    for (const serviceDate of proposedExceptionDates) {
      dates.add(this.databaseDateKey(serviceDate));
    }

    for (const serviceDate of [...dates].sort()) {
      const resolved = await this.scheduleResolution.resolveConfiguredSchedule(
        draft.practiceLocationId,
        serviceDate,
        transaction,
      );
      if (!resolved.isOpen || !resolved.opensAt || !resolved.closesAt) {
        continue;
      }

      const available = await this.doctorCalendar.isAvailableForInterval(
        draft.doctorProfileId,
        resolved.opensAt,
        resolved.closesAt,
        transaction,
      );
      if (!available) {
        throw new ConflictException(
          'Doctor Calendar unavailability overlaps the proposed clinic hours.',
        );
      }

      await this.crossLocationConflict.assertNoConflictForInterval(
        draft.doctorProfileId,
        draft.practiceLocationId,
        resolved.opensAt,
        resolved.closesAt,
        transaction,
      );
    }
  }

  private async lockApprovalDraft(
    transaction: TransactionClient,
    draftId: string,
  ): Promise<LockedApprovalDraft> {
    const rows = await transaction.$queryRaw<LockedApprovalDraft[]>(Prisma.sql`
      SELECT
        d."id",
        d."practiceLocationId",
        d."status",
        pl."lifecycleStatus",
        pl."doctorProfileId",
        pl."timeZone",
        dp."userId" AS "doctorUserId"
      FROM "SecretarySettingsDraft" d
      INNER JOIN "PracticeLocation" pl ON pl."id" = d."practiceLocationId"
      INNER JOIN "DoctorProfile" dp ON dp."id" = pl."doctorProfileId"
      WHERE d."id" = ${draftId}
      LIMIT 1
      FOR UPDATE OF d, pl
    `);
    const draft = rows[0];
    if (!draft) {
      throw new NotFoundException('Settings draft was not found.');
    }
    return draft;
  }

  private assertOwningDoctor(
    actor: ApprovalActor,
    authenticatedUserId: string,
    draft: LockedApprovalDraft,
  ): void {
    if (
      !actor ||
      actor.role !== UserRole.DOCTOR ||
      actor.accountStatus !== UserAccountStatus.ACTIVE ||
      actor.administrativeRestrictionStatus !==
        AdministrativeRestrictionStatus.NONE ||
      draft.doctorUserId !== authenticatedUserId
    ) {
      throw new ForbiddenException(
        'Only the eligible owning doctor may approve this settings draft.',
      );
    }
  }

  private async acquireCommandLock(
    transaction: TransactionClient,
    commandIdentityKey: string,
  ): Promise<void> {
    await transaction.$executeRaw(Prisma.sql`
      SELECT pg_advisory_xact_lock(hashtextextended(${commandIdentityKey}, 0))
    `);
  }

  private async acquireDoctorScheduleLock(
    transaction: TransactionClient,
    doctorProfileId: string,
  ): Promise<void> {
    const scope = `DOCTOR_SCHEDULE|${doctorProfileId}`;
    await transaction.$executeRaw(Prisma.sql`
      SELECT pg_advisory_xact_lock(hashtextextended(${scope}, 0))
    `);
  }

  private async lockUser(
    transaction: TransactionClient,
    userId: string,
  ): Promise<void> {
    await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id"
      FROM "User"
      WHERE "id" = ${userId}
      LIMIT 1
      FOR UPDATE
    `);
  }

  private normalizeIdempotencyKey(value: string): string {
    const normalized = value?.trim();
    if (!normalized) {
      throw new BadRequestException('Idempotency-Key header is required.');
    }
    if (normalized.length > 100) {
      throw new BadRequestException('Idempotency-Key is too long.');
    }
    return normalized;
  }

  private assertCompatibleReplay(
    storedFingerprint: string,
    requestFingerprint: string,
  ): void {
    if (storedFingerprint !== requestFingerprint) {
      throw new ConflictException(
        'Idempotency-Key was already used for a different request.',
      );
    }
  }

  private databaseDateKey(value: Date): string {
    return `${String(value.getUTCFullYear()).padStart(4, '0')}-${String(
      value.getUTCMonth() + 1,
    ).padStart(2, '0')}-${String(value.getUTCDate()).padStart(2, '0')}`;
  }

  private hash(value: string): string {
    return createHash('sha256').update(value, 'utf8').digest('hex');
  }
}
