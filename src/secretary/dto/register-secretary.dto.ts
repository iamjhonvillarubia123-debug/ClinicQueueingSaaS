import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

const trimString = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class RegisterSecretaryDto {
  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  firstName!: string;

  @Transform(trimString)
  @IsOptional()
  @IsString()
  @MaxLength(100)
  middleName?: string;

  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  lastName!: string;

  @Transform(trimString)
  @IsEmail()
  @IsNotEmpty()
  @MaxLength(255)
  email!: string;

  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  mobileNumber!: string;

  @IsString()
  @IsNotEmpty()
  password!: string;
}
