import {
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsUUID,
} from 'class-validator';

import { ClinicSecretaryAuthorityBundle } from '../secretary-authority.types';

export class AssignPracticeStaffDto {
  @IsUUID()
  @IsNotEmpty()
  practiceLocationId!: string;

  @IsUUID()
  @IsNotEmpty()
  userId!: string;

  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsEnum(ClinicSecretaryAuthorityBundle, { each: true })
  authorityBundles?: ClinicSecretaryAuthorityBundle[];
}
