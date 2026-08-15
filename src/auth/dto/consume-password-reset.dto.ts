import { IsNotEmpty, IsString } from 'class-validator';

export class ConsumePasswordResetDto {
  @IsString()
  @IsNotEmpty()
  token!: string;

  @IsString()
  @IsNotEmpty()
  newPassword!: string;
}
