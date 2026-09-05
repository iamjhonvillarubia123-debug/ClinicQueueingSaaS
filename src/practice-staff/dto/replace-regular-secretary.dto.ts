import {
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsOptional,
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
  authorityBundles?: ClinicSecretaryAuthorityBundle[];

  @IsOptional()
  @IsBoolean()
  requestedCancelClinicDay?: boolean;

  @IsString()
  @IsNotEmpty()
  password!: string;
}
