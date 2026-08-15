import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createHmac, randomBytes } from 'crypto';

const KEY_DERIVATION_PURPOSE = 'notification-outbox-message-v1';

@Injectable()
export class NotificationPayloadService {
  private readonly encryptionKey: Buffer;
  private readonly activeKeyId: string;

  constructor(private readonly configService: ConfigService) {
    const keyBase64 = this.configService.getOrThrow<string>(
      'MOBILE_ENCRYPTION_KEY_V1',
    );
    const activeKeyId = this.configService.getOrThrow<string>(
      'MOBILE_ENCRYPTION_ACTIVE_KEY_ID',
    );
    const baseKey = Buffer.from(keyBase64, 'base64');

    if (baseKey.length !== 32) {
      throw new Error(
        'MOBILE_ENCRYPTION_KEY_V1 must decode to exactly 32 bytes.',
      );
    }
    if (!activeKeyId.trim()) {
      throw new Error('MOBILE_ENCRYPTION_ACTIVE_KEY_ID must not be blank.');
    }

    this.encryptionKey = createHmac('sha256', baseKey)
      .update(KEY_DERIVATION_PURPOSE, 'utf8')
      .digest();
    this.activeKeyId = activeKeyId.trim();
  }

  encryptMessage(plaintext: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.encryptionKey, iv);
    const purpose = 'notification-outbox:message';
    cipher.setAAD(Buffer.from(purpose, 'utf8'));

    const ciphertext = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);

    return [
      'v1',
      this.activeKeyId,
      purpose,
      iv.toString('base64url'),
      cipher.getAuthTag().toString('base64url'),
      ciphertext.toString('base64url'),
    ].join('.');
  }
}
