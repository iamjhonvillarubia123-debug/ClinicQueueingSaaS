import { IsUUID } from 'class-validator';

export class ReplaceSubstituteSecretaryDto {
  @IsUUID()
  clinicDayId!: string;

  @IsUUID()
  userId!: string;
}
