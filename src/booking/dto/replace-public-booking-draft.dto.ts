import { OmitType } from '@nestjs/mapped-types';
import { ReplaceBookingDraftDto } from './replace-booking-draft.dto';

export class ReplacePublicBookingDraftDto extends OmitType(
  ReplaceBookingDraftDto,
  ['practiceLocationId'] as const,
) {}
