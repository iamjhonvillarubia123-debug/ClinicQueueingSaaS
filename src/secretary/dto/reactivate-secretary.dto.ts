import { IsString } from 'class-validator';

export class ReactivateSecretaryDto {
  @IsString()
  identifier!: string;

  @IsString()
  password!: string;
}
