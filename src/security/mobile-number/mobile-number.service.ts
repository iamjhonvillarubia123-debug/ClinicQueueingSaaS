import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
} from 'crypto';
import { MobileNumberNormalizer } from './mobile-number-normalizer';

export interface NormalizedMobileNumber {
  canonical: string;
  lastFour: string;
}

export interface ProtectedMobileNumber {
  encrypted: string;
  hash: string;
  lastFour: string;
}

@Injectable()
export class MobileNumberService {
  private readonly encryptionKey: Buffer;
  private readonly lookupHmacKey: Buffer;
  private readonly activeEncryptionKeyId: string;
  private readonly activeLookupKeyId: string;

  constructor(
    private readonly normalizer: MobileNumberNormalizer,
    private readonly configService: ConfigService,
  ) {
    const encryptionKeyBase64 =
      this.configService.getOrThrow<string>(
        'MOBILE_ENCRYPTION_KEY_V1',
      );

    const lookupHmacKeyBase64 =
      this.configService.getOrThrow<string>(
        'MOBILE_LOOKUP_HMAC_KEY_V1',
      );

    const activeEncryptionKeyId =
      this.configService.getOrThrow<string>(
        'MOBILE_ENCRYPTION_ACTIVE_KEY_ID',
      );

    const activeLookupKeyId =
      this.configService.getOrThrow<string>(
        'MOBILE_LOOKUP_ACTIVE_KEY_ID',
      );

    const encryptionKey = Buffer.from(
      encryptionKeyBase64,
      'base64',
    );

    const lookupHmacKey = Buffer.from(
      lookupHmacKeyBase64,
      'base64',
    );

    if (encryptionKey.length !== 32) {
      throw new Error(
        'MOBILE_ENCRYPTION_KEY_V1 must decode to exactly 32 bytes.',
      );
    }

    if (lookupHmacKey.length !== 32) {
      throw new Error(
        'MOBILE_LOOKUP_HMAC_KEY_V1 must decode to exactly 32 bytes.',
      );
    }

    if (!activeEncryptionKeyId.trim()) {
      throw new Error(
        'MOBILE_ENCRYPTION_ACTIVE_KEY_ID must not be blank.',
      );
    }

    if (!activeLookupKeyId.trim()) {
      throw new Error(
        'MOBILE_LOOKUP_ACTIVE_KEY_ID must not be blank.',
      );
    }

    this.encryptionKey = encryptionKey;
    this.lookupHmacKey = lookupHmacKey;
    this.activeEncryptionKeyId =
      activeEncryptionKeyId.trim();
    this.activeLookupKeyId = activeLookupKeyId.trim();
  }

  normalize(input: string): NormalizedMobileNumber {
    const canonical = this.normalizer.normalize(input);

    return {
      canonical,
      lastFour: canonical.slice(-4),
    };
  }

  protect(input: string): ProtectedMobileNumber {
  const { canonical, lastFour } = this.normalize(input);

  return {
    encrypted: this.encryptCanonical(canonical),
    hash: this.hashCanonical(canonical),
    lastFour,
  };
    }

  hashCanonical(canonical: string): string {
    return createHmac('sha256', this.lookupHmacKey)
      .update(canonical, 'utf8')
      .digest('hex');
  }

  encryptCanonical(canonical: string): string {
  const iv = randomBytes(12);

  const cipher = createCipheriv(
    'aes-256-gcm',
    this.encryptionKey,
    iv,
  );

  const ciphertext = Buffer.concat([
    cipher.update(canonical, 'utf8'),
    cipher.final(),
  ]);

  const authenticationTag = cipher.getAuthTag();

  return [
    'v1',
    this.activeEncryptionKeyId,
    iv.toString('base64url'),
    authenticationTag.toString('base64url'),
    ciphertext.toString('base64url'),
  ].join('.');
}

decrypt(envelope: string): string {
  const parts = envelope.split('.');

  if (parts.length !== 5) {
    throw new Error('Invalid mobile number encryption envelope.');
  }

  const [
    formatVersion,
    keyId,
    ivBase64Url,
    authenticationTagBase64Url,
    ciphertextBase64Url,
  ] = parts;

  if (formatVersion !== 'v1') {
    throw new Error('Unsupported mobile number encryption format.');
  }

  if (keyId !== this.activeEncryptionKeyId) {
    throw new Error('Unknown mobile number encryption key.');
  }

  try {
    const iv = Buffer.from(ivBase64Url, 'base64url');
    const authenticationTag = Buffer.from(
      authenticationTagBase64Url,
      'base64url',
    );
    const ciphertext = Buffer.from(
      ciphertextBase64Url,
      'base64url',
    );

    const decipher = createDecipheriv(
      'aes-256-gcm',
      this.encryptionKey,
      iv,
    );

    decipher.setAuthTag(authenticationTag);

    const plaintext = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString('utf8');

    return this.normalizer.normalize(plaintext);
  } catch {
    throw new Error(
      'Unable to decrypt protected mobile number.',
    );
  }
    }

}