import { resolveAppointmentMode } from '../schedule/appointment-mode.configuration';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PublicRoutingService } from '../public-routing/public-routing.service';
import { PublicServiceDateAvailabilityService } from '../schedule/public-service-date-availability.service';
import { BookingConfigurationService } from './booking-configuration.service';
import { BookingDraftEditService } from './booking-draft-edit.service';
import { BookingService } from './booking.service';
import { CreatePublicBookingDraftDto } from './dto/create-public-booking-draft.dto';
import { ReplacePublicBookingDraftDto } from './dto/replace-public-booking-draft.dto';
import { TimeSlotAvailabilityDto } from './dto/time-slot-availability.dto';
import { loadTimeSlotCalendar } from '../schedule/time-slot-reservations';
import { TimeSlotAvailabilityPolicy } from '../schedule/time-slot-availability.policy';

@Injectable()
export class PublicBookingEntryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly publicRouting: PublicRoutingService,
    private readonly configuration: BookingConfigurationService,
    private readonly availability: PublicServiceDateAvailabilityService,
    private readonly bookingService: BookingService,
    private readonly bookingDraftEditService: BookingDraftEditService,
  ) {}

  async getConfiguration(publicIdentifier: string) {
    const location = await this.resolveBookableLocation(publicIdentifier);
    const config = await this.configuration.getEffectiveConfiguration(
      location.id,
    );

    return {
      practiceLocation: {
        publicIdentifier: location.publicIdentifier,
        name: config.practiceLocation.name,
        timeZone: config.practiceLocation.timeZone,
      },
      bookingWindow: config.bookingWindow,
      services: config.services,
      bookingQuestions: config.bookingQuestions,
      serviceSelection: config.serviceSelection,
    };
  }

  async getAvailability(publicIdentifier: string, serviceDate: string) {
    const location = await this.resolveBookableLocation(publicIdentifier);
    const result = await this.availability.resolve(location.id, serviceDate);
    const mode = await resolveAppointmentMode(
      this.prisma,
      location.id,
      new Date(`${serviceDate}T00:00:00.000Z`),
    );
    const publicResult: Record<string, unknown> = { ...result, ...mode };
    delete publicResult.practiceLocationId;
    return publicResult;
  }

  async getTimeSlots(
    publicIdentifier: string,
    dto: TimeSlotAvailabilityDto,
  ): Promise<{
    available: boolean;
    reason?: string;
    appointmentMode?: string;
    reservationTimes: Date[];
    actualServiceMinutes?: number[];
    schedulingAllotmentMinutes?: number[];
    memberAvailability?: Date[][];
    alternatives?: string[];
    message?: string | null;
    alternateDates?: { serviceDate: string; reservationTimes: Date[] }[];
    alternativeSearchThrough?: string;
    alternateClinics?: {
      publicIdentifier: string;
      name: string | null;
      requiresServiceSelection: boolean;
    }[];
    contactClinic?: boolean;
  }> {
    const location = await this.resolveBookableLocation(publicIdentifier);
    const result = await this.prisma.$transaction(async (transaction) => {
      const policy = new TimeSlotAvailabilityPolicy();
      const actual: number[] = [];
      for (const member of dto.members) {
        const services = await transaction.practiceLocationService.findMany({
          where: {
            practiceLocationId: location.id,
            status: 'ACTIVE',
            id: { in: member.selectedServiceIds },
          },
          select: { durationMinutes: true },
        });
        if (services.length !== member.selectedServiceIds.length)
          throw new BadRequestException(
            'Selected Services are unavailable at this clinic.',
          );
        actual.push(
          policy.actualDuration(services.map((s) => s.durationMinutes)),
        );
      }
      const admission = await this.availability.resolve(
        location.id,
        dto.serviceDate,
        new Date(),
        transaction,
      );
      if (!admission.availableForPublicBooking)
        return {
          available: false,
          reason: admission.reason,
          actualServiceMinutes: actual,
          reservationTimes: [],
        };
      const { configuration, calendar, toInstant } = await loadTimeSlotCalendar(
        transaction,
        this.availability,
        location.id,
        new Date(`${dto.serviceDate}T00:00:00.000Z`),
      );
      if (configuration.appointmentMode !== 'TIME_SLOT_MODE')
        return { available: false, reason: 'QUEUE_MODE', reservationTimes: [] };
      const group = actual.length > 1;
      const starts = group
        ? policy.continuousGroup(
            calendar,
            actual,
            configuration.maximumBookableMinutes,
          )
        : policy.individual(
            calendar,
            actual[0],
            configuration.maximumBookableMinutes,
          );
      const allotments = group
        ? policy.groupAllotments(actual, configuration.maximumBookableMinutes)
        : actual;
      return {
        appointmentMode: configuration.appointmentMode,
        available: starts.length > 0,
        reservationTimes: starts.map(toInstant),
        actualServiceMinutes: actual,
        schedulingAllotmentMinutes: allotments,
        memberAvailability: group
          ? allotments.map((minutes) =>
              policy.starts(calendar, minutes).map(toInstant),
            )
          : undefined,
        alternatives: starts.length
          ? []
          : [
              ...(group ? ['FRAGMENTED_SAME_DAY'] : []),
              'ANOTHER_DATE',
              'ANOTHER_CLINIC',
              'CONTACT_CLINIC',
            ],
        message: starts.length
          ? null
          : !group &&
              configuration.maximumBookableMinutes !== null &&
              actual[0] > configuration.maximumBookableMinutes
            ? 'Selected Services exceed this clinic�s maximum online duration. Contact the clinic for assistance.'
            : 'No reservation fits. Try another active date or clinic, select available member times for a group, or contact the clinic for assistance.',
      };
    });
    if (
      result.available ||
      ('reason' in result && result.reason === 'QUEUE_MODE')
    )
      return result;
    const actual =
      'actualServiceMinutes' in result
        ? result.actualServiceMinutes
        : undefined;
    return {
      ...result,
      ...(await this.getRecoveryOptions(location.id, dto.serviceDate, actual)),
    };
  }

  private async getRecoveryOptions(
    locationId: string,
    serviceDate: string,
    actual?: number[],
  ) {
    const location = await this.prisma.practiceLocation.findUniqueOrThrow({
      where: { id: locationId },
      select: { doctorProfileId: true },
    });
    const alternateDates: { serviceDate: string; reservationTimes: Date[] }[] =
      [];
    const policy = new TimeSlotAvailabilityPolicy();
    let searchedThrough = serviceDate;
    // Bounded read-only suggestions, never provisional reservations. Patients can
    // request a later date to continue searching within the approved booking window.
    if (actual?.length) {
      for (
        let offset = 1;
        offset <= 31 && alternateDates.length < 3;
        offset++
      ) {
        const candidate = new Date(`${serviceDate}T00:00:00.000Z`);
        candidate.setUTCDate(candidate.getUTCDate() + offset);
        const dateKey = candidate.toISOString().slice(0, 10);
        searchedThrough = dateKey;
        const admission = await this.availability.resolve(locationId, dateKey);
        if (admission.reason === 'OUTSIDE_ADVANCE_BOOKING_WINDOW') break;
        if (!admission.availableForPublicBooking) continue;
        const { configuration, calendar, toInstant } =
          await loadTimeSlotCalendar(
            this.prisma,
            this.availability,
            locationId,
            candidate,
          );
        if (configuration.appointmentMode !== 'TIME_SLOT_MODE') continue;
        const starts =
          actual.length > 1
            ? policy.continuousGroup(
                calendar,
                actual,
                configuration.maximumBookableMinutes,
              )
            : policy.individual(
                calendar,
                actual[0],
                configuration.maximumBookableMinutes,
              );
        if (starts.length)
          alternateDates.push({
            serviceDate: dateKey,
            reservationTimes: starts.map(toInstant),
          });
      }
    }
    const candidates = await this.prisma.practiceLocation.findMany({
      where: {
        doctorProfileId: location.doctorProfileId,
        id: { not: locationId },
        lifecycleStatus: 'ACTIVE',
        isBookingEnabled: true,
      },
      select: { publicIdentifier: true, name: true },
      orderBy: { name: 'asc' },
    });
    const alternateClinics: {
      publicIdentifier: string;
      name: string | null;
      requiresServiceSelection: boolean;
    }[] = [];
    for (const candidate of candidates) {
      const route = await this.publicRouting.getPracticeLocationPublicRoute(
        candidate.publicIdentifier,
      );
      if (route.bookingEntryAllowed)
        alternateClinics.push({ ...candidate, requiresServiceSelection: true });
    }
    return {
      alternateDates,
      alternativeSearchThrough: searchedThrough,
      alternateClinics,
      contactClinic: true,
    };
  }

  async createDraft(
    publicIdentifier: string,
    dto: CreatePublicBookingDraftDto,
  ) {
    const location = await this.resolveBookableLocation(publicIdentifier);
    const availability = await this.availability.resolve(
      location.id,
      dto.serviceDate,
    );

    if (!availability.availableForPublicBooking) {
      throw new BadRequestException(
        'Selected Service Date is not available for public booking.',
      );
    }

    const result = await this.bookingService.createDraft({
      ...dto,
      practiceLocationId: location.id,
    });
    return this.sanitizeCreatedDraftResult(result);
  }

  async replaceDraft(
    publicIdentifier: string,
    bookingDraftId: string,
    dto: ReplacePublicBookingDraftDto,
  ) {
    const location = await this.resolveBookableLocation(publicIdentifier);
    return this.bookingDraftEditService.replaceDraft(bookingDraftId, {
      ...dto,
      practiceLocationId: location.id,
    });
  }

  private sanitizeCreatedDraftResult<T extends { bookingDraft: object }>(
    result: T,
  ) {
    const publicDraft: Record<string, unknown> = { ...result.bookingDraft };
    delete publicDraft.practiceLocationId;
    return { ...result, bookingDraft: publicDraft };
  }

  private async resolveBookableLocation(publicIdentifier: string) {
    const route =
      await this.publicRouting.getPracticeLocationPublicRoute(publicIdentifier);

    if (!route.bookingEntryAllowed) {
      throw new BadRequestException(
        'Practice location is not currently available for online booking.',
      );
    }

    const location = await this.prisma.practiceLocation.findUnique({
      where: { publicIdentifier: route.publicIdentifier },
      select: { id: true, publicIdentifier: true },
    });

    if (!location) {
      throw new NotFoundException('Practice location public route not found.');
    }

    return location;
  }
}
