import { IsEmail, IsString } from 'class-validator';

export class ReactivateDoctorDto {
  @IsEmail()
  email!: string;

  @IsString()
  password!: string;
}
