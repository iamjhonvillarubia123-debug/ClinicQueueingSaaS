import { Transform } from 'class-transformer';
import { IsEmail, IsUUID, MaxLength } from 'class-validator';

const trimString = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class ResolveExistingSecretaryDto {
  @IsUUID()
  practiceLocationId!: string;

  @Transform(trimString)
  @IsEmail()
  @MaxLength(255)
  email!: string;
}
