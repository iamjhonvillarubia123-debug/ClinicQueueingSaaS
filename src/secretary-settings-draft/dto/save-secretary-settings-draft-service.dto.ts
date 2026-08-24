import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
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

  @IsOptional()
  @IsInt()
  @Min(0)
  displayOrder?: number;
}
