import { InvitationCoverageRangeDto } from './invitation-coverage-range.dto';
import { Transform, Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  ArrayMaxSize,
  ValidateNested,
  ArrayUnique,
  IsBoolean,
  IsArray,
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
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => InvitationCoverageRangeDto)
  coverageRanges?: InvitationCoverageRangeDto[];

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsUUID('all', { each: true })
  replacePendingInvitationIds?: string[];

  @IsUUID() @IsNotEmpty() practiceLocationId!: string;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsNotEmpty()
  @MaxLength(255)
  identifier!: string;

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

  // Current Doctor re-authentication secret. It is never a Secretary credential.
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  password?: string;

  @IsOptional()
  @IsBoolean()
  requestedCancelClinicDay?: boolean;
}
