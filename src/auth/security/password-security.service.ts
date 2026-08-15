import { BadRequestException, Injectable } from '@nestjs/common';
import * as bcrypt from 'bcrypt';

const PASSWORD_BCRYPT_SALT_ROUNDS = 12;

@Injectable()
export class PasswordSecurityService {
  assertValid(password: string): void {
    if (!password.trim()) {
      throw new BadRequestException('Password must not be blank.');
    }
  }

  async hash(password: string): Promise<string> {
    this.assertValid(password);
    return bcrypt.hash(password, PASSWORD_BCRYPT_SALT_ROUNDS);
  }
  async verify(password: string, passwordHash: string): Promise<boolean> {
    return bcrypt.compare(password, passwordHash);
  }
}
