import { IsBoolean, IsEnum, IsOptional, Matches } from 'class-validator';
import { Weekday } from '../../../generated/prisma/client';

const LOCAL_TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

export class UpsertSecretarySettingsDraftPracticeScheduleDto {
  @IsEnum(Weekday)
  weekday!: Weekday;

  @IsBoolean()
  isOpen!: boolean;

  @IsOptional()
  @Matches(LOCAL_TIME_PATTERN)
  opensAtLocal?: string;

  @IsOptional()
  @Matches(LOCAL_TIME_PATTERN)
  closesAtLocal?: string;

  @IsOptional()
  @Matches(LOCAL_TIME_PATTERN)
  maximumOnlineBookingUntilLocal?: string;

  @IsOptional()
  @Matches(LOCAL_TIME_PATTERN)
  maximumOperatingUntilLocal?: string;
}
