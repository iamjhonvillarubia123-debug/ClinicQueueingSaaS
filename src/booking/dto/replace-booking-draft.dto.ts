import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { CreateBookingDraftDto } from './create-booking-draft.dto';

export class ReplaceBookingDraftDto extends CreateBookingDraftDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  draftControlToken!: string;
}

export class BookingDraftControlDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  draftControlToken!: string;
}
