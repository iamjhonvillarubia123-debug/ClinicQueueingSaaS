import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { SecretaryAccessProfile } from '../../../generated/prisma/client';

const trimString = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class CreateSecretaryInvitationDto {
  @IsUUID()
  practiceLocationId!: string;

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
  @IsEmail()
  @MaxLength(255)
  email!: string;

  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  mobileNumber!: string;

  @IsOptional()
  @IsEnum(SecretaryAccessProfile)
  accessProfile?: SecretaryAccessProfile;

  @IsOptional()
  @IsBoolean()
  canManageClinicDetails?: boolean;

  @IsOptional()
  @IsBoolean()
  canManageServices?: boolean;

  @IsOptional()
  @IsBoolean()
  canManageBookingQuestions?: boolean;

  @IsOptional()
  @IsBoolean()
  canManageSchedules?: boolean;

  @IsOptional()
  @IsBoolean()
  cancelClinicDay?: boolean;

  @IsOptional()
  @IsBoolean()
  assignDaySecretary?: boolean;
}
