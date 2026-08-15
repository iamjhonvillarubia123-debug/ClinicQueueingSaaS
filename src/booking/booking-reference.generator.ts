import { Injectable } from '@nestjs/common';
import { randomInt } from 'crypto';

@Injectable()
export class BookingReferenceGenerator {
  private readonly alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

  generate(): string {
    let randomPart = '';

    for (let index = 0; index < 6; index += 1) {
      const characterIndex = randomInt(0, this.alphabet.length);

      randomPart += this.alphabet[characterIndex];
    }

    return `CQ-${randomPart}`;
  }
}
