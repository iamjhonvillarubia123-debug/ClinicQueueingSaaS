import {
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsString,
  IsUUID,
} from 'class-validator';

import { ClinicSecretaryAuthorityBundle } from '../secretary-authority.types';

export class ReplaceRegularSecretaryDto {
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
  authorityBundles!: ClinicSecretaryAuthorityBundle[];

  @IsString()
  @IsNotEmpty()
  password!: string;
}
