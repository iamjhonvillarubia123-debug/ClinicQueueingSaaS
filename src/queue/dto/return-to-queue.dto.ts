import { IsDateString, IsUUID } from 'class-validator';

export class ReturnToQueueDto {
  @IsUUID()
  practiceLocationId!: string;

  @IsDateString({ strict: true })
  serviceDate!: string;

  @IsUUID()
  appointmentId!: string;
}
