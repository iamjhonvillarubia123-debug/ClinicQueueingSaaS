import { IsEmail, IsNotEmpty, MaxLength } from 'class-validator';

export class ResendEmailVerificationDto {
  @IsEmail()
  @IsNotEmpty()
  @MaxLength(255)
  email!: string;
}
