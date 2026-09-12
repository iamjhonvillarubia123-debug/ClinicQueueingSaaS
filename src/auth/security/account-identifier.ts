import { BadRequestException } from '@nestjs/common';
import { isEmail } from 'class-validator';
import { MobileNumberService } from '../../security/mobile-number/mobile-number.service';
import { normalizeEmail } from './session-security';

export type AccountIdentifier =
  | { type: 'EMAIL'; normalized: string; mobileHash: null }
  | { type: 'MOBILE'; normalized: string; mobileHash: string };

export function parseAccountIdentifier(
  input: string,
  mobileNumberService: MobileNumberService,
): AccountIdentifier {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new BadRequestException(
      'Enter a valid email address or Philippine mobile number.',
    );
  }

  if (trimmed.includes('@')) {
    const normalized = normalizeEmail(trimmed);
    if (!isEmail(normalized)) {
      throw new BadRequestException(
        'Enter a valid email address or Philippine mobile number.',
      );
    }
    return { type: 'EMAIL', normalized, mobileHash: null };
  }

  try {
    const normalized = mobileNumberService.normalize(trimmed).canonical;
    return {
      type: 'MOBILE',
      normalized,
      mobileHash: mobileNumberService.hashCanonical(normalized),
    };
  } catch {
    throw new BadRequestException(
      'Enter a valid email address or Philippine mobile number.',
    );
  }
}

export function accountIdentifierIsVerified(user: {
  loginIdentifierType: 'EMAIL' | 'MOBILE';
  emailVerifiedAt: Date | null;
  mobileVerifiedAt: Date | null;
}): boolean {
  return user.loginIdentifierType === 'EMAIL'
    ? user.emailVerifiedAt !== null
    : user.mobileVerifiedAt !== null;
}
