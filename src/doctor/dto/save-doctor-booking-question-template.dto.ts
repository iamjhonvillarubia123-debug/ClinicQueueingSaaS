import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { BookingQuestionType } from '../../../generated/prisma/client';

export class DoctorBookingQuestionSelectOptionDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  value!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  label!: string;
}

export class SaveDoctorBookingQuestionTemplateDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  questionText!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  helpText?: string;

  @IsEnum(BookingQuestionType)
  type!: BookingQuestionType;

  @IsBoolean()
  isRequired!: boolean;

  @IsInt()
  @Min(0)
  displayOrder!: number;

  @IsBoolean()
  isActive!: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  textMaximumLength?: number;

  @IsOptional()
  @IsNumber()
  numberMinimum?: number;

  @IsOptional()
  @IsNumber()
  numberMaximum?: number;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DoctorBookingQuestionSelectOptionDto)
  selectOptions?: DoctorBookingQuestionSelectOptionDto[];
}
