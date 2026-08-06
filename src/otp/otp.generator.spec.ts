import { OtpGenerator } from './otp.generator';

describe('OtpGenerator', () => {
  let generator: OtpGenerator;

  beforeEach(() => {
    generator = new OtpGenerator();
  });

  it('should generate a six-digit OTP string', () => {
    const otp = generator.generate();

    expect(otp).toMatch(/^\d{6}$/);
  });
});