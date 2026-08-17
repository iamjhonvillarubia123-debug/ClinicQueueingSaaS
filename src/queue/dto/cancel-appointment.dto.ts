import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateIf,
} from 'class-validator';

export const APPOINTMENT_CANCELLATION_REASONS = [
  'PATIENT_REQUESTED',
  'CLINIC_REQUESTED',
  'DUPLICATE_BOOKING',
  'OTHER',
] as const;

export type AppointmentCancellationReason =
  (typeof APPOINTMENT_CANCELLATION_REASONS)[number];

export class CancelAppointmentBodyDto {
  @IsIn(APPOINTMENT_CANCELLATION_REASONS)
  reason!: AppointmentCancellationReason;

  @ValidateIf((dto: CancelAppointmentBodyDto) => dto.reason === 'OTHER')
  @IsString()
  @IsNotEmpty()
  @MaxLength(220)
  @ValidateIf((dto: CancelAppointmentBodyDto) => dto.reason !== 'OTHER')
  @IsOptional()
  note?: string;
}

export class CancelAppointmentDto extends CancelAppointmentBodyDto {
  @IsUUID()
  appointmentId!: string;
}
