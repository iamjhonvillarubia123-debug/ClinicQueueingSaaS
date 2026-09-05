import { IsNotEmpty, IsString, IsUUID } from 'class-validator';

export class RemoveRegularSecretaryDto {
  @IsUUID()
  @IsNotEmpty()
  practiceLocationId!: string;

  @IsString()
  @IsNotEmpty()
  password!: string;
}
