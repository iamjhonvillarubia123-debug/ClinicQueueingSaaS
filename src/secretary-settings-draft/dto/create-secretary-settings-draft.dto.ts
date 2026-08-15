import { IsNotEmpty, IsUUID } from 'class-validator';

export class CreateSecretarySettingsDraftDto {
  @IsUUID()
  @IsNotEmpty()
  practiceLocationId!: string;
}
