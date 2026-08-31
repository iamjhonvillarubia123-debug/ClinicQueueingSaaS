import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsString,
  MaxLength,
} from 'class-validator';
import { UserRole } from '../../../generated/prisma/client';

const trimString = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export type PublicAccountRole =
  | typeof UserRole.DOCTOR
  | typeof UserRole.SECRETARY;

export class RegisterAccountDto {
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

  @IsIn([UserRole.DOCTOR, UserRole.SECRETARY])
  role!: PublicAccountRole;
}
