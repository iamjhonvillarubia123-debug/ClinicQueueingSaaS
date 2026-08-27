import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  BookingQuestionType,
  ServiceAvailabilityStatus,
} from '../../../generated/prisma/client';
import { DraftPracticeScheduleRowDto } from './save-draft-practice-schedule.dto';

export class DoctorClinicDraftBasicInfoDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  @Matches(/^[A-Za-z0-9_-]+$/, {
    message: 'Short code may contain only letters, numbers, hyphens, and underscores.',
  })
  shortCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  addressLine1?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  addressLine2?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  cityMunicipality?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  province?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  postalCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  contactNumber?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(255)
  clinicEmail?: string;

  @IsOptional()
  @IsString()
  @MaxLength(250)
  clinicDescription?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[A-Z]{2}$/)
  countryCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  timeZone?: string;
}

export class DoctorClinicDraftServiceDto {
  @IsOptional()
  @IsString()
  effectiveServiceId?: string;

  @IsOptional()
  @IsString()
  sourceDoctorServiceTemplateId?: string;

  @IsString()
  @MaxLength(150)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(250)
  description?: string;

  @IsInt()
  @Min(1)
  @Max(1440)
  durationMinutes!: number;

  @IsEnum(ServiceAvailabilityStatus)
  status!: ServiceAvailabilityStatus;
}

export class DoctorClinicDraftQuestionDto {
  @IsOptional()
  @IsString()
  effectiveBookingQuestionId?: string;

  @IsOptional()
  @IsString()
  sourceDoctorBookingQuestionTemplateId?: string;

  @IsString()
  @MaxLength(500)
  questionText!: string;

  @IsEnum(BookingQuestionType)
  type!: BookingQuestionType;

  @IsBoolean()
  isRequired!: boolean;

  @IsInt()
  @Min(0)
  displayOrder!: number;

  @IsBoolean()
  isActive!: boolean;
}

export class SaveDoctorClinicConfigurationDraftDto {
  @ValidateNested()
  @Type(() => DoctorClinicDraftBasicInfoDto)
  basicInfo!: DoctorClinicDraftBasicInfoDto;

  @IsArray()
  @ArrayMinSize(7)
  @ArrayMaxSize(7)
  @ValidateNested({ each: true })
  @Type(() => DraftPracticeScheduleRowDto)
  schedules!: DraftPracticeScheduleRowDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DoctorClinicDraftServiceDto)
  services!: DoctorClinicDraftServiceDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DoctorClinicDraftQuestionDto)
  bookingQuestions!: DoctorClinicDraftQuestionDto[];
}
