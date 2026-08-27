import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  Matches,
  ValidateNested,
} from 'class-validator';
import { Weekday } from '../../../generated/prisma/client';

const LOCAL_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export class DraftPracticeScheduleRowDto {
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

  @IsOptional()
  @IsString()
  @Matches(LOCAL_TIME_PATTERN)
  maximumOnlineBookingUntilLocal?: string;

  @IsOptional()
  @IsString()
  @Matches(LOCAL_TIME_PATTERN)
  maximumOperatingUntilLocal?: string;
}

export class SaveDraftPracticeScheduleDto {
  @IsArray()
  @ArrayMinSize(7)
  @ArrayMaxSize(7)
  @ValidateNested({ each: true })
  @Type(() => DraftPracticeScheduleRowDto)
  schedules!: DraftPracticeScheduleRowDto[];
}
