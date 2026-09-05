import { Transform } from 'class-transformer';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

const trimString = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class CompleteDoctorOnboardingDto {
  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  firstName!: string;

  @Transform(trimString)
  @IsOptional()
  @IsString()
  @MaxLength(100)
  middleName?: string;

  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  lastName!: string;

  @Transform(trimString)
  @IsOptional()
  @IsString()
  @MaxLength(30)
  suffix?: string;

  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  professionalTitle!: string;

  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  specialization!: string;

  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  licenseNumber!: string;

  @Transform(trimString)
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  profileDescription?: string;
}
