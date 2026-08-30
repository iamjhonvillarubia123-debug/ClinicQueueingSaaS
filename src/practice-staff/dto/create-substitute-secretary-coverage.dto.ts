import { IsEnum, IsNotEmpty, IsUUID, Matches } from 'class-validator';

import { SubstituteSecretaryCoverageMode } from '../substitute-secretary-coverage.types';

export class CreateSubstituteSecretaryCoverageDto {
  @IsUUID()
  @IsNotEmpty()
  practiceLocationId!: string;

  @IsUUID()
  @IsNotEmpty()
  userId!: string;

  @IsEnum(SubstituteSecretaryCoverageMode)
  coverageMode!: SubstituteSecretaryCoverageMode;

  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  fromServiceDate!: string;

  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  toServiceDate!: string;
}
