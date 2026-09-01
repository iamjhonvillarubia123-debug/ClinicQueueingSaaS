import { ArrayNotEmpty, ArrayUnique, IsArray, IsEnum } from 'class-validator';
import { ClinicSecretaryAuthorityBundle } from '../secretary-authority.types';

export class UpdateClinicSecretaryAuthorityDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsEnum(ClinicSecretaryAuthorityBundle, { each: true })
  authorityBundles!: ClinicSecretaryAuthorityBundle[];
}
