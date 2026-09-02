import {
  IsBoolean,
  IsDateString,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';

export class ConfirmDoctorCalendarRuleDto {
  @IsDateString()
  date!: string;

  @IsBoolean()
  cancelAffectedAppointments!: boolean;

  @IsOptional()
  @IsString()
  @MinLength(1)
  password?: string;
}
