import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class VerifyEmailDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  token!: string;
}
