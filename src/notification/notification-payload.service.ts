import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
} from 'crypto';

const KEY_DERIVATION_PURPOSE = 'notification-outbox-message-v1';
const MESSAGE_PURPOSE = 'notification-outbox:message';

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
    cipher.setAAD(Buffer.from(MESSAGE_PURPOSE, 'utf8'));

    const ciphertext = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);

    return [
      'v1',
      this.activeKeyId,
      MESSAGE_PURPOSE,
      iv.toString('base64url'),
      cipher.getAuthTag().toString('base64url'),
      ciphertext.toString('base64url'),
    ].join('.');
  }

  decryptMessage(envelope: string): string {
    const parts = envelope.split('.');
    if (parts.length !== 6) {
      throw new Error('Invalid notification message encryption envelope.');
    }

    const [
      formatVersion,
      keyId,
      purpose,
      ivBase64Url,
      authenticationTagBase64Url,
      ciphertextBase64Url,
    ] = parts;

    if (formatVersion !== 'v1') {
      throw new Error('Unsupported notification message encryption format.');
    }
    if (keyId !== this.activeKeyId) {
      throw new Error('Unknown notification message encryption key.');
    }
    if (purpose !== MESSAGE_PURPOSE) {
      throw new Error('Invalid notification message encryption purpose.');
    }

    try {
      const iv = Buffer.from(ivBase64Url, 'base64url');
      const authenticationTag = Buffer.from(
        authenticationTagBase64Url,
        'base64url',
      );
      const ciphertext = Buffer.from(ciphertextBase64Url, 'base64url');
      const decipher = createDecipheriv('aes-256-gcm', this.encryptionKey, iv);
      decipher.setAAD(Buffer.from(MESSAGE_PURPOSE, 'utf8'));
      decipher.setAuthTag(authenticationTag);

      return Buffer.concat([
        decipher.update(ciphertext),
        decipher.final(),
      ]).toString('utf8');
    } catch {
      throw new Error('Unable to decrypt protected notification message.');
    }
  }
}
