import { IsNotEmpty, IsString, IsUUID, Length } from 'class-validator';

export class VerifyMobileAccountDto {
  @IsUUID()
  userId!: string;

  @IsString()
  @IsNotEmpty()
  @Length(6, 6)
  otp!: string;
}

export class ResendMobileAccountVerificationDto {
  @IsUUID()
  userId!: string;
}
