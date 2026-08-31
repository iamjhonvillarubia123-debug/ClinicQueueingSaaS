import {
  ArrayNotEmpty,
  ArrayUnique,
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
  @IsString() @IsNotEmpty() @MaxLength(100) firstName!: string;
  @IsString() @IsNotEmpty() @MaxLength(100) lastName!: string;
  @IsEmail() @MaxLength(255) email!: string;
  @IsString() @IsNotEmpty() @MaxLength(30) mobileNumber!: string;

  @IsEnum(SecretaryInvitationAssignmentType)
  assignmentType!: SecretaryInvitationAssignmentType;

  @ValidateIf((dto: CreateSecretaryInvitationDto) =>
    dto.assignmentType === SecretaryInvitationAssignmentType.CLINIC_SECRETARY,
  )
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsEnum(ClinicSecretaryAuthorityBundle, { each: true })
  authorityBundles?: ClinicSecretaryAuthorityBundle[];

  @ValidateIf((dto: CreateSecretaryInvitationDto) =>
    dto.assignmentType === SecretaryInvitationAssignmentType.SUBSTITUTE_SECRETARY,
  )
  @IsEnum(SubstituteSecretaryCoverageMode)
  coverageMode?: SubstituteSecretaryCoverageMode;

  @ValidateIf((dto: CreateSecretaryInvitationDto) =>
    dto.assignmentType === SecretaryInvitationAssignmentType.SUBSTITUTE_SECRETARY,
  )
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  fromServiceDate?: string;

  @ValidateIf((dto: CreateSecretaryInvitationDto) =>
    dto.assignmentType === SecretaryInvitationAssignmentType.SUBSTITUTE_SECRETARY,
  )
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  toServiceDate?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  password?: string;
}
