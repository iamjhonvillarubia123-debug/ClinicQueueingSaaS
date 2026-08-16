import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export const EXISTING_PATIENT_RESPONSES = ['YES', 'NO', 'UNSURE'] as const;

export type ExistingPatientResponse =
  (typeof EXISTING_PATIENT_RESPONSES)[number];

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

  @IsIn(EXISTING_PATIENT_RESPONSES)
  existingPatientResponse!: ExistingPatientResponse;

  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  mobileNumber!: string;

  @IsDateString()
  serviceDate!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(3)
  @IsString({ each: true })
  selectedServiceIds!: string[];
}
