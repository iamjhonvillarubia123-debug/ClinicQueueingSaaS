import { Transform } from 'class-transformer';
import { IsEmail, IsNotEmpty, IsString, IsUUID, MaxLength } from 'class-validator';

const trimString = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class CreateSecretaryInvitationDto {
  @IsUUID()
  practiceLocationId!: string;

  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  firstName!: string;

  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  lastName!: string;

  @Transform(trimString)
  @IsEmail()
  @MaxLength(255)
  email!: string;

  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  mobileNumber!: string;
}
