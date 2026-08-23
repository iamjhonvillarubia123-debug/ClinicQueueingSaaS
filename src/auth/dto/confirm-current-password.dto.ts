import { IsNotEmpty, IsString } from 'class-validator';

export class ConfirmCurrentPasswordDto {
  @IsString()
  @IsNotEmpty()
  currentPassword!: string;
}
