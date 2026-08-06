import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { MobileNumberNormalizer } from './mobile-number-normalizer';
import { MobileNumberService } from './mobile-number.service';

describe('MobileNumberService', () => {
  let service: MobileNumberService;

  const encryptionKeyBase64 = Buffer.alloc(
  32,
  1,
).toString('base64');

const lookupHmacKeyBase64 = Buffer.alloc(
  32,
  2,
).toString('base64');

const configServiceMock = {
  getOrThrow: jest.fn((name: string) => {
    const values: Record<string, string> = {
      MOBILE_ENCRYPTION_KEY_V1: encryptionKeyBase64,
      MOBILE_LOOKUP_HMAC_KEY_V1: lookupHmacKeyBase64,
      MOBILE_ENCRYPTION_ACTIVE_KEY_ID: 'v1',
      MOBILE_LOOKUP_ACTIVE_KEY_ID: 'v1',
    };

    const value = values[name];

    if (!value) {
      throw new Error(`Missing test configuration: ${name}`);
    }

    return value;
  }),
};

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MobileNumberNormalizer,
        MobileNumberService,
        {
          provide: ConfigService,
          useValue: configServiceMock,
        },
      ],
    }).compile();

    service = module.get<MobileNumberService>(
      MobileNumberService,
    );

    jest.clearAllMocks();
  });

  it('should return the canonical number and last four digits', () => {
    expect(
      service.normalize('+63 917 123 4567'),
    ).toEqual({
      canonical: '639171234567',
      lastFour: '4567',
    });
     });

  it('should produce the same lookup hash for the same canonical number', () => {
  const firstHash = service.hashCanonical('639171234567');
  const secondHash = service.hashCanonical('639171234567');

  expect(firstHash).toBe(secondHash);
  expect(firstHash).toHaveLength(64);
    });

    it('should produce different lookup hashes for different canonical numbers', () => {
  const firstHash = service.hashCanonical('639171234567');
  const secondHash = service.hashCanonical('639181234567');

  expect(firstHash).not.toBe(secondHash);
  expect(firstHash).toHaveLength(64);
  expect(secondHash).toHaveLength(64);
    });

    it('should produce different ciphertext for repeated encryption of the same number', () => {
  const firstCiphertext =
    service.encryptCanonical('639171234567');

  const secondCiphertext =
    service.encryptCanonical('639171234567');

  expect(firstCiphertext).not.toBe(secondCiphertext);
  expect(firstCiphertext).toMatch(/^v1\.v1\./);
  expect(secondCiphertext).toMatch(/^v1\.v1\./);
    });

    it('should decrypt an encrypted canonical mobile number', () => {
  const canonical = '639171234567';

  const encrypted = service.encryptCanonical(canonical);
  const decrypted = service.decrypt(encrypted);

  expect(decrypted).toBe(canonical);
    });

    it('should reject tampered ciphertext', () => {
  const encrypted =
    service.encryptCanonical('639171234567');

  const parts = encrypted.split('.');
  const ciphertext = parts[4];

  const tamperedCharacter =
    ciphertext.endsWith('A') ? 'B' : 'A';

  parts[4] =
    ciphertext.slice(0, -1) + tamperedCharacter;

  const tamperedEnvelope = parts.join('.');

  expect(() =>
    service.decrypt(tamperedEnvelope),
  ).toThrow(
    'Unable to decrypt protected mobile number.',
  );
    });

    it('should protect a mobile number without returning the canonical plaintext', () => {
  const result = service.protect('+63 917 123 4567');

  expect(result.encrypted).toMatch(/^v1\.v1\./);
  expect(result.hash).toHaveLength(64);
  expect(result.lastFour).toBe('4567');
  expect(result).not.toHaveProperty('canonical');

  expect(service.decrypt(result.encrypted)).toBe(
    '639171234567',
  );
    });

});