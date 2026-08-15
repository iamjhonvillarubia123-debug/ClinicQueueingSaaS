import { IsUUID } from 'class-validator';

export class AssignSubstituteSecretaryDto {
  @IsUUID()
  clinicDayId!: string;

  @IsUUID()
  userId!: string;
}
