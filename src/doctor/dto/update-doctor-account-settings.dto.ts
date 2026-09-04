import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

export class UpdateDoctorAccountSettingsDto {
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MaxLength(100)
  defaultTimeZone?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsInt()
  @Min(0)
  @Max(365)
  maximumAdvanceBookingDays?: number;

  @ValidateIf((_object, value) => value !== undefined)
  @IsBoolean()
  allowOnlineBooking?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(4320)
  maximumEstimatedServiceMinutesPerPatient?: number | null;
}
