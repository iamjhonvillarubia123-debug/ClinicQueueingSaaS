import { Transform } from 'class-transformer';
import {
  ArrayNotEmpty,
  ArrayUnique,
  IsBoolean,
  IsArray,
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { ClinicSecretaryAuthorityBundle } from '../secretary-authority.types';
import { SubstituteSecretaryCoverageMode } from '../substitute-secretary-coverage.types';

export enum SecretaryInvitationAssignmentType {
  CLINIC_SECRETARY = 'CLINIC_SECRETARY',
  SUBSTITUTE_SECRETARY = 'SUBSTITUTE_SECRETARY',
}

export class CreateSecretaryInvitationDto {
  @IsUUID() @IsNotEmpty() practiceLocationId!: string;

  @Transform(({ value, obj }: { value: unknown; obj: Record<string, unknown> }) =>
    typeof value === 'string' && value.trim()
      ? value.trim().toLowerCase()
      : typeof obj.email === 'string' && obj.email.trim()
        ? obj.email.trim().toLowerCase()
        : value,
  )
  @IsEmail()
  @IsNotEmpty()
  @MaxLength(255)
  identifier!: string;

  // Transitional wire compatibility for the existing clinic staff container.
  // The service ignores these profile fields and derives the Secretary's
  // authoritative identity from the matched User account. Mobile-only
  // invitation input is intentionally not accepted.
  @IsOptional() @IsString() @MaxLength(100) firstName!: string;
  @IsOptional() @IsString() @MaxLength(100) lastName!: string;
  @IsOptional() @IsString() @MaxLength(255) email!: string;
  @IsOptional() @IsString() @MaxLength(255) mobileNumber!: string;

  @IsEnum(SecretaryInvitationAssignmentType)
  assignmentType!: SecretaryInvitationAssignmentType;

  @ValidateIf(
    (dto: CreateSecretaryInvitationDto) =>
      dto.assignmentType === SecretaryInvitationAssignmentType.CLINIC_SECRETARY,
  )
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsEnum(ClinicSecretaryAuthorityBundle, { each: true })
  authorityBundles?: ClinicSecretaryAuthorityBundle[];

  @ValidateIf(
    (dto: CreateSecretaryInvitationDto) =>
      dto.assignmentType ===
      SecretaryInvitationAssignmentType.SUBSTITUTE_SECRETARY,
  )
  @IsEnum(SubstituteSecretaryCoverageMode)
  coverageMode?: SubstituteSecretaryCoverageMode;

  @ValidateIf(
    (dto: CreateSecretaryInvitationDto) =>
      dto.assignmentType ===
      SecretaryInvitationAssignmentType.SUBSTITUTE_SECRETARY,
  )
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  fromServiceDate?: string;

  @ValidateIf(
    (dto: CreateSecretaryInvitationDto) =>
      dto.assignmentType ===
      SecretaryInvitationAssignmentType.SUBSTITUTE_SECRETARY,
  )
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  toServiceDate?: string;

  // This is the current Doctor's re-authentication secret when replacement
  // or Cancel Clinic Day authorization requires it. It is never a Secretary
  // credential.
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  password?: string;

  @IsOptional()
  @IsBoolean()
  requestedCancelClinicDay?: boolean;
}
