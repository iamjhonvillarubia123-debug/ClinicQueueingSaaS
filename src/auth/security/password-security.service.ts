import { BadRequestException, Injectable } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { createHash } from 'crypto';

const PASSWORD_BCRYPT_SALT_ROUNDS = 12;

@Injectable()
export class PasswordSecurityService {
  assertValid(password: string): void {
    if (
      typeof password !== 'string' ||
      password.length < 8 ||
      password.length > 128 ||
      !/[A-Z]/.test(password) ||
      !/[a-z]/.test(password) ||
      !/\d/.test(password) ||
      !/[^A-Za-z0-9]/.test(password)
    ) {
      throw new BadRequestException(
        'Password must be 8 to 128 characters and include an uppercase letter, lowercase letter, number, and special character.',
      );
    }
  }

  async hash(password: string): Promise<string> {
    this.assertValid(password);
    return bcrypt.hash(password, PASSWORD_BCRYPT_SALT_ROUNDS);
  }
  async verify(password: string, passwordHash: string): Promise<boolean> {
    if (passwordHash.startsWith('sha256-bcrypt:')) {
      return bcrypt.compare(
        this.passwordDigest(password),
        passwordHash.slice('sha256-bcrypt:'.length),
      );
    }
    return bcrypt.compare(password, passwordHash);
  }

  assertStrong(password: string): void {
    if (
      typeof password !== 'string' ||
      [...password].length < 15 ||
      [...password].length > 128 ||
      !password.trim()
    ) {
      throw new BadRequestException(
        'Use a passphrase between 15 and 128 characters.',
      );
    }
    if (
      /^(.)\1+$/u.test(password) ||
      /^(password|1234567890|qwerty|letmein|abcdefghij)+[!\d]*$/i.test(password)
    ) {
      throw new BadRequestException('Choose a less predictable passphrase.');
    }
  }

  async hashStrong(password: string): Promise<string> {
    this.assertStrong(password);
    // A versioned digest avoids bcrypt silently truncating long/Unicode passphrases.
    return (
      'sha256-bcrypt:' +
      (await bcrypt.hash(
        this.passwordDigest(password),
        PASSWORD_BCRYPT_SALT_ROUNDS,
      ))
    );
  }

  private passwordDigest(password: string) {
    return createHash('sha256')
      .update('clinic-password-v1\0')
      .update(password, 'utf8')
      .digest('base64');
  }
}
