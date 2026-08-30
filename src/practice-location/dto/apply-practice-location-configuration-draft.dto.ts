import {
  Equals,
  IsBoolean,
  IsNotEmpty,
  IsString,
  IsUUID,
} from 'class-validator';

export class ApplyPracticeLocationConfigurationDraftDto {
  @IsUUID()
  @IsNotEmpty()
  practiceLocationId!: string;

  @IsString()
  @IsNotEmpty()
  password!: string;

  @IsBoolean()
  @Equals(true)
  confirmApply!: boolean;
}
