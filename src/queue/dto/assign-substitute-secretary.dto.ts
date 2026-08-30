import { IsOptional, IsUUID, Matches } from 'class-validator';

export class AssignSubstituteSecretaryDto {
  @IsOptional()
  @IsUUID()
  clinicDayId?: string;

  @IsOptional()
  @IsUUID()
  practiceLocationId?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  serviceDate?: string;

  @IsUUID()
  userId!: string;
}
