import { IsNotEmpty, IsString, IsUUID } from 'class-validator';

export class ReplaceRegularSecretaryDto {
  @IsUUID()
  @IsNotEmpty()
  practiceLocationId!: string;

  @IsUUID()
  @IsNotEmpty()
  userId!: string;

  @IsString()
  @IsNotEmpty()
  password!: string;
}
