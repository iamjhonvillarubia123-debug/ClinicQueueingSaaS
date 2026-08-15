import { IsEmail, IsString } from 'class-validator';

export class ReactivateSecretaryDto {
  @IsEmail()
  email!: string;

  @IsString()
  password!: string;
}
