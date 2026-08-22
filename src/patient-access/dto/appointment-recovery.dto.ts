import { IsDateString, IsNotEmpty, IsString, IsUUID, Length } from 'class-validator';

export class RequestAppointmentRecoveryDto {
  @IsString()
  @IsNotEmpty()
  practiceLocationPublicIdentifier!: string;

  @IsDateString()
  serviceDate!: string;

  @IsString()
  @IsNotEmpty()
  mobileNumber!: string;
}

export class VerifyAppointmentRecoveryOtpDto {
  @IsUUID()
  recoveryAttemptId!: string;

  @IsString()
  @Length(6, 6)
  otp!: string;
}
