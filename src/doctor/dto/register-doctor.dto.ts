import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

const trimString = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class RegisterDoctorDto {
  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  firstName!: string;

  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  lastName!: string;

  @Transform(trimString)
  @IsOptional()
  @IsString()
  @MaxLength(100)
  middleName?: string;

  @Transform(trimString)
  @IsEmail()
  @IsNotEmpty()
  @MaxLength(255)
  email!: string;

  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  mobileNumber!: string;

  @IsString()
  @IsNotEmpty()
  password!: string;

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
  @MaxLength(30)
  suffix?: string;

  @Transform(trimString)
  @IsOptional()
  @IsString()
  @MaxLength(100)
  defaultTimeZone?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  defaultConsultationMinutes?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  maximumAdvanceBookingDays?: number;

  @IsOptional()
  @IsBoolean()
  allowOnlineBooking?: boolean;
}
