import { IsBoolean, IsString } from 'class-validator';

export class PermanentlyDeleteSecretaryDto {
  @IsString()
  identifier!: string;

  @IsString()
  password!: string;

  @IsBoolean()
  confirmPermanentDelete!: boolean;
}
