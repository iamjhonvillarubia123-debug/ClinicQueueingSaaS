import { InvitationCoverageRangeDto } from './invitation-coverage-range.dto';
import { Transform, Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  ArrayMaxSize,
  ValidateNested,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Matches,
  ValidateIf,
} from 'class-validator';
import { ClinicSecretaryAuthorityBundle } from '../secretary-authority.types';
import { SubstituteSecretaryCoverageMode } from '../substitute-secretary-coverage.types';
import { SecretaryInvitationAssignmentType } from './create-secretary-invitation.dto';

export class UpdateSecretaryInvitationDto {
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => InvitationCoverageRangeDto)
  coverageRanges?: InvitationCoverageRangeDto[];

  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
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

  // Current Doctor re-authentication secret. It is never a Secretary credential.
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  password?: string;

  @IsOptional()
  @IsBoolean()
  requestedCancelClinicDay?: boolean;
}
