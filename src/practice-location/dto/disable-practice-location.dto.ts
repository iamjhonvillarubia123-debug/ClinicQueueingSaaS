import {
  Equals,
  IsBoolean,
  IsNotEmpty,
  IsString,
  IsUUID,
} from 'class-validator';

export class DisablePracticeLocationDto {
  @IsUUID()
  @IsNotEmpty()
  practiceLocationId!: string;

  @IsString()
  @IsNotEmpty()
  password!: string;

  @IsBoolean()
  @Equals(true)
  confirmDisable!: boolean;
}
