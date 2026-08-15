import { ConfigService } from '@nestjs/config';
import { ProtectedAccountPayloadService } from './protected-account-payload.service';

describe('ProtectedAccountPayloadService', () => {
  const key = Buffer.alloc(32, 7).toString('base64');
  const configService = {
    getOrThrow: jest.fn((name: string) => {
      if (name === 'MOBILE_ENCRYPTION_KEY_V1') return key;
      if (name === 'MOBILE_ENCRYPTION_ACTIVE_KEY_ID') return 'v1';
      throw new Error(`Unexpected config key: ${name}`);
    }),
  } as unknown as ConfigService;

  it('encrypts and decrypts only for the intended purpose', () => {
    const service = new ProtectedAccountPayloadService(configService);
    const envelope = service.encrypt(
      'doctor@example.com',
      'doctor-email-verification:recipient',
    );

    expect(envelope).not.toContain('doctor@example.com');
    expect(
      service.decrypt(envelope, 'doctor-email-verification:recipient'),
    ).toBe('doctor@example.com');
    expect(() =>
      service.decrypt(envelope, 'doctor-email-verification:message'),
    ).toThrow('Invalid protected account payload envelope.');
  });
});
