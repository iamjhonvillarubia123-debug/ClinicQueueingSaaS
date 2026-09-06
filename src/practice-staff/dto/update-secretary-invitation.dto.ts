import { Transform } from 'class-transformer';
import {
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsOptional,
  MaxLength,
  Matches,
  ValidateIf,
} from 'class-validator';
import { ClinicSecretaryAuthorityBundle } from '../secretary-authority.types';
import { SubstituteSecretaryCoverageMode } from '../substitute-secretary-coverage.types';
import { SecretaryInvitationAssignmentType } from './create-secretary-invitation.dto';

export class UpdateSecretaryInvitationDto {
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  @MaxLength(255)
  identifier?: string;

  @IsEnum(SecretaryInvitationAssignmentType)
  assignmentType!: SecretaryInvitationAssignmentType;

  @ValidateIf(
    (dto: UpdateSecretaryInvitationDto) =>
      dto.assignmentType === SecretaryInvitationAssignmentType.CLINIC_SECRETARY,
  )
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsEnum(ClinicSecretaryAuthorityBundle, { each: true })
  authorityBundles?: ClinicSecretaryAuthorityBundle[];

  @ValidateIf(
    (dto: UpdateSecretaryInvitationDto) =>
      dto.assignmentType ===
      SecretaryInvitationAssignmentType.SUBSTITUTE_SECRETARY,
  )
  @IsEnum(SubstituteSecretaryCoverageMode)
  coverageMode?: SubstituteSecretaryCoverageMode;

  @ValidateIf(
    (dto: UpdateSecretaryInvitationDto) =>
      dto.assignmentType ===
      SecretaryInvitationAssignmentType.SUBSTITUTE_SECRETARY,
  )
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  fromServiceDate?: string;

  @ValidateIf(
    (dto: UpdateSecretaryInvitationDto) =>
      dto.assignmentType ===
      SecretaryInvitationAssignmentType.SUBSTITUTE_SECRETARY,
  )
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  toServiceDate?: string;

  @IsOptional()
  @IsBoolean()
  requestedCancelClinicDay?: boolean;
}
