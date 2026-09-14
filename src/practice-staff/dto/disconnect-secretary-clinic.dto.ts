import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
export class DisconnectSecretaryClinicDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  password: string;
}
