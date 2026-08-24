import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class AcceptSecretaryInvitationDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  token!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  password!: string;
}
