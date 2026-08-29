import { IsBoolean, IsString, IsUUID, MinLength } from 'class-validator';

export class ActivatePracticeLocationDto {
  @IsUUID()
  practiceLocationId!: string;

  @IsString()
  @MinLength(1)
  password!: string;

  @IsBoolean()
  confirmActivation!: boolean;
}
