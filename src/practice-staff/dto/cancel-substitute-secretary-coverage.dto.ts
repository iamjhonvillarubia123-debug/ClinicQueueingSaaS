import { IsNotEmpty, IsUUID } from 'class-validator';

export class CancelSubstituteSecretaryCoverageDto {
  @IsUUID()
  @IsNotEmpty()
  coverageId!: string;
}
