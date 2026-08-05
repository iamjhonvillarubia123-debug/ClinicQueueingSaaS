import {
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { ExistingPatientResponse } from '../../../generated/prisma/client';

export class CreateBookingDraftDto {
  @IsString()
  @IsNotEmpty()
  practiceLocationId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  firstName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  middleName?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  lastName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  suffix?: string;

  @IsEnum(ExistingPatientResponse)
  existingPatientResponse!: ExistingPatientResponse;

  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  mobileNumber!: string;

  @IsDateString()
  serviceDate!: string;
}