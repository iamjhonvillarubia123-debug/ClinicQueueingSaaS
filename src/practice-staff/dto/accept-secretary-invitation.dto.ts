import { IsNotEmpty, IsString } from 'class-validator';

export class AcceptSecretaryInvitationDto {
  @IsString() @IsNotEmpty() token!: string;
}
