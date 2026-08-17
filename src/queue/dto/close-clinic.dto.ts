import { IsDateString, IsEnum, IsOptional, IsUUID } from 'class-validator';
import { ClinicClosureDisposition } from '../../../generated/prisma/client';

export class CloseClinicDto {
  @IsUUID()
  practiceLocationId!: string;

  @IsDateString({ strict: true })
  serviceDate!: string;

  @IsOptional()
  @IsEnum(ClinicClosureDisposition)
  finalPatientDisposition?: ClinicClosureDisposition;
}
