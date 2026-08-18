import {
  IsDateString,
  IsNotEmpty,
  IsString,
  IsUUID,
  Length,
} from 'class-validator';

export class RequestBookingGroupRecoveryDto {
  @IsUUID()
  practiceLocationId!: string;

  @IsDateString()
  serviceDate!: string;

  @IsString()
  @IsNotEmpty()
  mobileNumber!: string;
}

export class VerifyBookingGroupRecoveryOtpDto {
  @IsUUID()
  recoveryAttemptId!: string;

  @IsString()
  @Length(6, 6)
  otp!: string;
}
