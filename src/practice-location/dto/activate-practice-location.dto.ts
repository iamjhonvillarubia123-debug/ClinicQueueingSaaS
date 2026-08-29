import {
  IsBoolean,
  IsDefined,
  IsString,
  IsUUID,
  MinLength,
} from 'class-validator';

export class ActivatePracticeLocationDto {
  @IsUUID()
  practiceLocationId!: string;

  @IsDefined()
  @IsString()
  @MinLength(1)
  password?: string;

  @IsDefined()
  @IsBoolean()
  confirmActivation?: boolean;
}
