import { IsIn, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength, ValidateIf } from 'class-validator';

export const APPOINTMENT_CANCELLATION_REASONS = [
  'PATIENT_REQUESTED',
  'CLINIC_REQUESTED',
  'DUPLICATE_BOOKING',
  'OTHER',
] as const;

export type AppointmentCancellationReason =
  (typeof APPOINTMENT_CANCELLATION_REASONS)[number];

export class CancelAppointmentDto {
  @IsUUID()
  appointmentId!: string;

  @IsIn(APPOINTMENT_CANCELLATION_REASONS)
  reason!: AppointmentCancellationReason;

  @ValidateIf((dto: CancelAppointmentDto) => dto.reason === 'OTHER')
  @IsString()
  @IsNotEmpty()
  @MaxLength(220)
  note?: string;

  @ValidateIf((dto: CancelAppointmentDto) => dto.reason !== 'OTHER')
  @IsOptional()
  @IsString()
  @MaxLength(220)
  note?: string;
}
