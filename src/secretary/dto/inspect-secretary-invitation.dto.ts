import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class InspectSecretaryInvitationDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  token!: string;
}
