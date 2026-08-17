import { IsDateString, IsUUID } from 'class-validator';

export class StartClinicDto {
  @IsUUID()
  practiceLocationId!: string;

  @IsDateString({ strict: true })
  serviceDate!: string;
}
