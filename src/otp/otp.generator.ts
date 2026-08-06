import { Injectable } from '@nestjs/common';
import { randomInt } from 'crypto';

@Injectable()
export class OtpGenerator {
  generate(): string {
    const value = randomInt(0, 1_000_000);

    return value.toString().padStart(6, '0');
  }
}