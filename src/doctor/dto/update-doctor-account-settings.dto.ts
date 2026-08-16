import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class UpdateDoctorAccountSettingsDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(4320)
  maximumEstimatedServiceMinutesPerPatient?: number | null;
}
