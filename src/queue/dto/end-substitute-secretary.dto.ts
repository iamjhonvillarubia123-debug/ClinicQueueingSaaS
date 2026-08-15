import { IsUUID } from 'class-validator';

export class EndSubstituteSecretaryDto {
  @IsUUID()
  clinicDayId!: string;
}
