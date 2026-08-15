import { MobileNumberNormalizer } from './mobile-number-normalizer';
import { BadRequestException } from '@nestjs/common';

describe('MobileNumberNormalizer', () => {
  let normalizer: MobileNumberNormalizer;

  beforeEach(() => {
    normalizer = new MobileNumberNormalizer();
  });

  it('should convert a local Philippine mobile number to canonical format', () => {
    expect(normalizer.normalize('09171234567')).toBe('639171234567');
  });

  it('should keep an already canonical mobile number unchanged', () => {
    expect(normalizer.normalize('639171234567')).toBe('639171234567');
  });

  it('should reject an invalid Philippine mobile number', () => {
    expect(() => normalizer.normalize('12345')).toThrow(BadRequestException);

    expect(() => normalizer.normalize('12345')).toThrow(
      'Invalid Philippine mobile number.',
    );
  });

  it('should normalize a formatted international mobile number', () => {
    expect(normalizer.normalize('+63 917 123 4567')).toBe('639171234567');
  });
});
