import { IsBoolean, IsEmail, IsString } from 'class-validator';

export class PermanentlyDeleteSecretaryDto {
  @IsEmail()
  email!: string;

  @IsString()
  password!: string;

  @IsBoolean()
  confirmPermanentDelete!: boolean;
}
