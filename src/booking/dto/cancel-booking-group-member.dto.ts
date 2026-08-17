import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

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

  @IsOptional()
  @IsString()
  @MaxLength(200)
  note?: string;
}
