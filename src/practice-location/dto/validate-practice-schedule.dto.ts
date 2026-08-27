import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Weekday } from '../../../generated/prisma/client';

const LOCAL_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export class ProposedPracticeScheduleDto {
  @IsEnum(Weekday)
  weekday!: Weekday;

  @IsBoolean()
  isOpen!: boolean;

  @IsOptional()
  @IsString()
  @Matches(LOCAL_TIME_PATTERN)
  opensAtLocal?: string;

  @IsOptional()
  @IsString()
  @Matches(LOCAL_TIME_PATTERN)
  closesAtLocal?: string;
}

export class ValidatePracticeScheduleDto {
  @IsOptional()
  @IsString()
  practiceLocationId?: string;

  @IsString()
  @MaxLength(100)
  timeZone!: string;

  @IsArray()
  @ArrayMaxSize(7)
  @ValidateNested({ each: true })
  @Type(() => ProposedPracticeScheduleDto)
  schedules!: ProposedPracticeScheduleDto[];
}
