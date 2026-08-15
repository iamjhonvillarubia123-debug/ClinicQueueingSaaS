import { validate } from 'class-validator';
import { VerifyBookingOtpDto } from './verify-booking-otp.dto';

describe('VerifyBookingOtpDto', () => {
  it('should accept a valid booking draft ID and six-digit OTP', async () => {
    const dto = new VerifyBookingOtpDto();

    dto.bookingDraftId = 'draft-1';
    dto.otp = '123456';

    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
  });

  it('should reject an OTP that is not exactly six digits', async () => {
    const dto = new VerifyBookingOtpDto();

    dto.bookingDraftId = 'draft-1';
    dto.otp = '12A45';

    const errors = await validate(dto);

    expect(errors.length).toBeGreaterThan(0);
  });
});
