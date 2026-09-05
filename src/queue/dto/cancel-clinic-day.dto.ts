import {
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsString,
  IsUUID,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { ClinicDayCancellationReason } from '../../../generated/prisma/client';

export class CancelClinicDayDto {
  @IsUUID()
  practiceLocationId!: string;

  @IsDateString({ strict: true })
  serviceDate!: string;

  @IsEnum(ClinicDayCancellationReason)
  reason!: ClinicDayCancellationReason;

  @ValidateIf((dto: CancelClinicDayDto) => dto.reason === ClinicDayCancellationReason.OTHER)
  @IsString()
  @IsNotEmpty()
  @MaxLength(220)
  note?: string;

  @IsDateString({ strict: true })
  acknowledgedServiceDate!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  password!: string;
}
