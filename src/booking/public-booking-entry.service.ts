import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PublicRoutingService } from '../public-routing/public-routing.service';
import { PrismaService } from '../prisma/prisma.service';
import { PublicServiceDateAvailabilityService } from '../schedule/public-service-date-availability.service';
import { BookingConfigurationService } from './booking-configuration.service';
import { BookingService } from './booking.service';
import { CreatePublicBookingDraftDto } from './dto/create-public-booking-draft.dto';

@Injectable()
export class PublicBookingEntryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly publicRouting: PublicRoutingService,
    private readonly configuration: BookingConfigurationService,
    private readonly availability: PublicServiceDateAvailabilityService,
    private readonly bookingService: BookingService,
  ) {}

  async getConfiguration(publicIdentifier: string) {
    const location = await this.resolveBookableLocation(publicIdentifier);
    const config = await this.configuration.getEffectiveConfiguration(location.id);
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
    return this.availability.resolve(location.id, serviceDate);
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

    return this.bookingService.createDraft({
      ...dto,
      practiceLocationId: location.id,
    });
  }

  private async resolveBookableLocation(publicIdentifier: string) {
    const route = await this.publicRouting.getPracticeLocationPublicRoute(
      publicIdentifier,
    );
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
