import {
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { AdministrativeReasonCategory } from '../../../generated/prisma/client';

export class EmergencySuspendDoctorDto {
  @IsUUID()
  targetDoctorUserId!: string;

  @IsEnum(AdministrativeReasonCategory)
  reasonCategory!: AdministrativeReasonCategory;

  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  explanation!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  adminPassword!: string;

  @IsBoolean()
  confirmStopOperations!: boolean;
}
