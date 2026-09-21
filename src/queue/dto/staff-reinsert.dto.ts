import { IsBoolean, IsDateString, IsOptional, IsUUID } from 'class-validator';

export class StaffReinsertDto {
  @IsOptional()
  @IsBoolean()
  confirmReservationPriorityOverride?: boolean;
  @IsUUID()
  practiceLocationId!: string;

  @IsDateString({ strict: true })
  serviceDate!: string;

  @IsUUID()
  appointmentId!: string;

  @IsOptional()
  @IsUUID()
  afterAppointmentId?: string;
}
