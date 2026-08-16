import { IsBoolean, IsOptional, IsString, Matches } from 'class-validator';

export class UpsertSecretarySettingsDraftScheduleExceptionDto {
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  serviceDate!: string;

  @IsBoolean()
  isOpen!: boolean;

  @IsOptional()
  @IsString()
  @Matches(/^\d{2}:\d{2}$/)
  opensAtLocal?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{2}:\d{2}$/)
  closesAtLocal?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{2}:\d{2}$/)
  maximumOnlineBookingUntilLocal?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{2}:\d{2}$/)
  maximumOperatingUntilLocal?: string;
}
