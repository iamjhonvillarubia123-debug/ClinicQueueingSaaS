import { IsDateString, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateDoctorCalendarRuleDto {
  @IsDateString()
  date!: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  label?: string;
}
