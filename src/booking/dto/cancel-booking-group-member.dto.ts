import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';

export const BOOKING_GROUP_MEMBER_CANCELLATION_REASONS = [
  'PATIENT_REQUESTED',
  'CLINIC_REQUESTED',
  'DUPLICATE_BOOKING',
  'OTHER',
] as const;

export type BookingGroupMemberCancellationReason =
  (typeof BOOKING_GROUP_MEMBER_CANCELLATION_REASONS)[number];

export class CancelBookingGroupMemberDto {
  @IsIn(BOOKING_GROUP_MEMBER_CANCELLATION_REASONS)
  reason!: BookingGroupMemberCancellationReason;

  @ValidateIf((value: CancelBookingGroupMemberDto) => value.reason === 'OTHER')
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  note?: string;

  @ValidateIf((value: CancelBookingGroupMemberDto) => value.reason !== 'OTHER')
  @IsOptional()
  @IsString()
  @MaxLength(200)
  note?: string;
}
