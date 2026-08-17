import { Injectable, NotFoundException } from '@nestjs/common';
import { BookingDraftMode } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { IndividualBookingConfirmationService } from './individual-booking-confirmation.service';
import { MultiPersonBookingConfirmationService } from './multi-person-booking-confirmation.service';

@Injectable()
export class BookingConfirmationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly individual: IndividualBookingConfirmationService,
    private readonly multiPerson: MultiPersonBookingConfirmationService,
  ) {}

  async confirm(input: {
    bookingDraftId: string;
    idempotencyKey: string | undefined;
  }) {
    const draft = await this.prisma.bookingDraft.findUnique({
      where: { id: input.bookingDraftId },
      select: { mode: true },
    });
    if (!draft) {
      throw new NotFoundException(
        'Booking draft is not available for confirmation.',
      );
    }

    return draft.mode === BookingDraftMode.MULTI_PERSON
      ? this.multiPerson.confirm(input)
      : this.individual.confirm(input);
  }
}
