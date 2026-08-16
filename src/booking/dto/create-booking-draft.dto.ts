import { Type } from 'class-transformer';
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
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { BookingDraftAnswerDto } from './booking-draft-answer.dto';

export const EXISTING_PATIENT_RESPONSES = ['YES', 'NO', 'UNSURE'] as const;
export const BOOKING_DRAFT_MODES = ['INDIVIDUAL', 'MULTI_PERSON'] as const;

export type ExistingPatientResponse =
  (typeof EXISTING_PATIENT_RESPONSES)[number];
export type BookingDraftModeInput = (typeof BOOKING_DRAFT_MODES)[number];

export class CreateBookingDraftMemberDto {
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

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(3)
  @IsString({ each: true })
  selectedServiceIds!: string[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BookingDraftAnswerDto)
  answers?: BookingDraftAnswerDto[];
}

export class CreateBookingDraftDto {
  @IsString()
  @IsNotEmpty()
  practiceLocationId!: string;

  @IsIn(BOOKING_DRAFT_MODES)
  mode!: BookingDraftModeInput;

  @ValidateIf((dto: CreateBookingDraftDto) => dto.mode === 'INDIVIDUAL')
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  firstName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  middleName?: string;

  @ValidateIf((dto: CreateBookingDraftDto) => dto.mode === 'INDIVIDUAL')
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  lastName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  suffix?: string;

  @ValidateIf((dto: CreateBookingDraftDto) => dto.mode === 'INDIVIDUAL')
  @IsIn(EXISTING_PATIENT_RESPONSES)
  existingPatientResponse?: ExistingPatientResponse;

  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  mobileNumber!: string;

  @IsDateString()
  serviceDate!: string;

  @ValidateIf((dto: CreateBookingDraftDto) => dto.mode === 'INDIVIDUAL')
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(3)
  @IsString({ each: true })
  selectedServiceIds?: string[];

  @ValidateIf((dto: CreateBookingDraftDto) => dto.mode === 'INDIVIDUAL')
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BookingDraftAnswerDto)
  answers?: BookingDraftAnswerDto[];

  @ValidateIf((dto: CreateBookingDraftDto) => dto.mode === 'MULTI_PERSON')
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(5)
  @ValidateNested({ each: true })
  @Type(() => CreateBookingDraftMemberDto)
  members?: CreateBookingDraftMemberDto[];
}
