import { OmitType } from '@nestjs/mapped-types';
import { CreateBookingDraftDto } from './create-booking-draft.dto';

export class CreatePublicBookingDraftDto extends OmitType(
  CreateBookingDraftDto,
  ['practiceLocationId'] as const,
) {}
