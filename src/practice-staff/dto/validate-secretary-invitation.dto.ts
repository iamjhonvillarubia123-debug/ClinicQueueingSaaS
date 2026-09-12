import { IsNotEmpty, IsString, IsUUID, MaxLength } from 'class-validator';

export class ValidateSecretaryInvitationIdentifierDto {
  @IsUUID()
  @IsNotEmpty()
  practiceLocationId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  identifier!: string;
}

export class ValidateSecretaryInvitationAuthorizationDto {
  @IsUUID()
  @IsNotEmpty()
  practiceLocationId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  password!: string;
}
