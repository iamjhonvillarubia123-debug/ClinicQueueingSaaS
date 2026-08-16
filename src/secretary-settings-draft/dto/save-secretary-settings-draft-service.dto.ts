import { IsEnum, IsInt, IsNotEmpty, IsString, MaxLength, Min } from 'class-validator';
import { ServiceAvailabilityStatus } from '../../../generated/prisma/client';

export class SaveSecretarySettingsDraftServiceDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  name!: string;

  @IsInt()
  @Min(1)
  durationMinutes!: number;

  @IsEnum(ServiceAvailabilityStatus)
  status!: ServiceAvailabilityStatus;
}
