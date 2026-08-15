import { IsNotEmpty, IsString, IsUUID, MaxLength } from 'class-validator';

export class NormalRestoreDoctorDto {
  @IsUUID()
  targetDoctorUserId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  resolutionText!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  adminPassword!: string;
}
