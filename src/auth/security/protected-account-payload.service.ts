import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
} from 'crypto';

const KEY_DERIVATION_PURPOSE = 'account-notification-payload-v1';

@Injectable()
export class ProtectedAccountPayloadService {
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

    // Version 1 reuses the approved application encryption root, but derives
    // a purpose-specific key so account-email payloads are cryptographically
    // separated from mobile-number ciphertexts.
    this.encryptionKey = createHmac('sha256', baseKey)
      .update(KEY_DERIVATION_PURPOSE, 'utf8')
      .digest();
    this.activeKeyId = activeKeyId.trim();
  }

  encrypt(plaintext: string, purpose: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.encryptionKey, iv);
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

  decrypt(envelope: string, expectedPurpose: string): string {
    const parts = envelope.split('.');

    if (parts.length !== 6) {
      throw new Error('Invalid protected account payload envelope.');
    }

    const [version, keyId, purpose, ivEncoded, tagEncoded, ciphertextEncoded] =
      parts;

    if (
      version !== 'v1' ||
      keyId !== this.activeKeyId ||
      purpose !== expectedPurpose
    ) {
      throw new Error('Invalid protected account payload envelope.');
    }

    try {
      const decipher = createDecipheriv(
        'aes-256-gcm',
        this.encryptionKey,
        Buffer.from(ivEncoded, 'base64url'),
      );
      decipher.setAAD(Buffer.from(expectedPurpose, 'utf8'));
      decipher.setAuthTag(Buffer.from(tagEncoded, 'base64url'));

      return Buffer.concat([
        decipher.update(Buffer.from(ciphertextEncoded, 'base64url')),
        decipher.final(),
      ]).toString('utf8');
    } catch {
      throw new Error('Unable to decrypt protected account payload.');
    }
  }
}
