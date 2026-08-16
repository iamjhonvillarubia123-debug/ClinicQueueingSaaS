import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  PracticeLocationLifecycleStatus,
  ServiceAvailabilityStatus,
} from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const MAX_SELECTED_SERVICES = 3;
const MAX_ACTIVE_BOOKING_QUESTIONS = 5;

@Injectable()
export class BookingConfigurationService {
  constructor(private readonly prisma: PrismaService) {}

  async getEffectiveConfiguration(practiceLocationId: string) {
    const location = await this.prisma.practiceLocation.findFirst({
      where: {
        id: practiceLocationId,
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
        timeZone: true,
        services: {
          where: { status: ServiceAvailabilityStatus.ACTIVE },
          orderBy: [{ name: 'asc' }, { id: 'asc' }],
          select: {
            id: true,
            name: true,
            durationMinutes: true,
          },
        },
        bookingQuestions: {
          where: { isActive: true },
          orderBy: [{ displayOrder: 'asc' }, { id: 'asc' }],
          select: {
            id: true,
            questionText: true,
            helpText: true,
            type: true,
            isRequired: true,
            displayOrder: true,
            estimatedMinutesAdjustment: true,
            textMaximumLength: true,
            numberMinimum: true,
            numberMaximum: true,
            selectOptions: true,
          },
        },
      },
    });

    if (!location) {
      throw new NotFoundException(
        'Practice location is not available for online booking.',
      );
    }

    if (location.bookingQuestions.length > MAX_ACTIVE_BOOKING_QUESTIONS) {
      throw new BadRequestException(
        'Practice location configuration exceeds five active BookingQuestions.',
      );
    }

    return {
      practiceLocation: {
        id: location.id,
        name: location.name,
        timeZone: location.timeZone,
      },
      services: location.services,
      bookingQuestions: location.bookingQuestions,
      serviceSelection: {
        maximumSelections: MAX_SELECTED_SERVICES,
        uniqueSelectionsRequired: true,
        orderHasBusinessMeaning: false,
      },
    };
  }

  async validateSelectedServices(
    practiceLocationId: string,
    selectedServiceIds: string[],
  ) {
    const ids = selectedServiceIds.map((value) => value.trim());

    if (ids.some((value) => !value)) {
      throw new BadRequestException('Selected Service ids must be valid.');
    }
    if (ids.length > MAX_SELECTED_SERVICES) {
      throw new BadRequestException(
        'At most three Services may be selected for one prospective Appointment.',
      );
    }
    if (new Set(ids).size !== ids.length) {
      throw new BadRequestException('Duplicate Service selection is invalid.');
    }

    await this.assertLocationAvailable(practiceLocationId);

    if (ids.length === 0) {
      return [];
    }

    const services = await this.prisma.practiceLocationService.findMany({
      where: {
        id: { in: ids },
        practiceLocationId,
        status: ServiceAvailabilityStatus.ACTIVE,
      },
      orderBy: { id: 'asc' },
      select: {
        id: true,
        name: true,
        durationMinutes: true,
      },
    });

    if (services.length !== ids.length) {
      throw new BadRequestException(
        'One or more selected Services are inactive or do not belong to the selected PracticeLocation.',
      );
    }

    return services;
  }

  private async assertLocationAvailable(practiceLocationId: string) {
    const location = await this.prisma.practiceLocation.findFirst({
      where: {
        id: practiceLocationId,
        lifecycleStatus: PracticeLocationLifecycleStatus.ACTIVE,
        isBookingEnabled: true,
        doctorProfile: {
          accountSettings: {
            allowOnlineBooking: true,
          },
        },
      },
      select: { id: true },
    });

    if (!location) {
      throw new NotFoundException(
        'Practice location is not available for online booking.',
      );
    }
  }
}
