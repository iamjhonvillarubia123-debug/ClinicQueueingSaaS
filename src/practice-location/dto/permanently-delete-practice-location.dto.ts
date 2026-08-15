import {
  Equals,
  IsBoolean,
  IsNotEmpty,
  IsString,
  IsUUID,
} from 'class-validator';

export class PermanentlyDeletePracticeLocationDto {
  @IsUUID()
  @IsNotEmpty()
  practiceLocationId!: string;

  @IsString()
  @IsNotEmpty()
  password!: string;

  @IsBoolean()
  @Equals(true)
  confirmPermanentDelete!: boolean;
}
