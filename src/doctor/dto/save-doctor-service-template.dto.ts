import { IsEnum, IsInt, IsNotEmpty, IsString, Max, MaxLength, Min } from 'class-validator';
import { ServiceAvailabilityStatus } from '../../../generated/prisma/client';

export class SaveDoctorServiceTemplateDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  name!: string;

  @IsInt()
  @Min(1)
  @Max(1440)
  durationMinutes!: number;

  @IsEnum(ServiceAvailabilityStatus)
  status!: ServiceAvailabilityStatus;
}
