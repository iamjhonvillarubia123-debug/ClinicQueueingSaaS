import { IsBoolean, IsEnum, IsOptional, IsUUID } from 'class-validator';
import { SecretaryAccessProfile } from '../../../generated/prisma/client';

export class ConfigureSecretaryAccessDto {
  @IsUUID()
  practiceLocationId!: string;

  @IsUUID()
  userId!: string;

  @IsEnum(SecretaryAccessProfile)
  accessProfile!: SecretaryAccessProfile;

  @IsOptional() @IsBoolean() canManageClinicDetails?: boolean;
  @IsOptional() @IsBoolean() canManageServices?: boolean;
  @IsOptional() @IsBoolean() canManageBookingQuestions?: boolean;
  @IsOptional() @IsBoolean() canManageSchedules?: boolean;
  @IsOptional() @IsBoolean() cancelClinicDay?: boolean;
  @IsOptional() @IsBoolean() assignDaySecretary?: boolean;
}
