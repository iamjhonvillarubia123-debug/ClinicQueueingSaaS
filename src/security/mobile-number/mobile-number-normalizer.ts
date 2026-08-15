import { BadRequestException, Injectable } from '@nestjs/common';

@Injectable()
export class MobileNumberNormalizer {
  normalize(input: string): string {
    const trimmed = input.trim();
    const digitsOnly = trimmed.replace(/\D/g, '');

    if (/^09\d{9}$/.test(digitsOnly)) {
      return `63${digitsOnly.substring(1)}`;
    }

    if (/^639\d{9}$/.test(digitsOnly)) {
      return digitsOnly;
    }

    throw new BadRequestException('Invalid Philippine mobile number.');
  }
}
