import {
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateBookingDraftDto } from './dto/create-booking-draft.dto';

@Injectable()
export class BookingService {
  constructor(
    private readonly prisma: PrismaService,
  ) {}

  async createDraft(
    createBookingDraftDto: CreateBookingDraftDto,
  ) {
    const practiceLocation =
      await this.prisma.practiceLocation.findFirst({
        where: {
          id: createBookingDraftDto.practiceLocationId,
          isActive: true,
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
        },
      });

    if (!practiceLocation) {
      throw new NotFoundException(
        'Practice location is not available for online booking.',
      );
    }

    return {
      message: 'Practice location is available for online booking.',
      practiceLocation,
      request: createBookingDraftDto,
    };
  }
}