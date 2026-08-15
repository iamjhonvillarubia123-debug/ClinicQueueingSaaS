import { IsNotEmpty, IsString, Length, Matches } from 'class-validator';

export class VerifyBookingOtpDto {
  @IsString()
  @IsNotEmpty()
  bookingDraftId!: string;

  @IsString()
  @Length(6, 6)
  @Matches(/^\d{6}$/, {
    message: 'OTP must be exactly 6 digits.',
  })
  otp!: string;
}
