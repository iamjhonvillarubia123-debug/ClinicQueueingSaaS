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
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { BookingDraftAnswerDto } from './booking-draft-answer.dto';
import {
  EXISTING_PATIENT_RESPONSES,
  type ExistingPatientResponse,
} from './create-booking-draft.dto';

export class CreateStaffAppointmentDto {
  @IsUUID()
  practiceLocationId!: string;

  @IsDateString({ strict: true })
  serviceDate!: string;

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

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(3)
  @IsUUID('4', { each: true })
  selectedServiceIds!: string[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BookingDraftAnswerDto)
  answers?: BookingDraftAnswerDto[];
}
