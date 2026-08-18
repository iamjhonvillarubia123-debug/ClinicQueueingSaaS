import { ConfigService } from '@nestjs/config';
import { NotificationPayloadService } from './notification-payload.service';

describe('NotificationPayloadService', () => {
  const encryptionKeyBase64 = Buffer.alloc(32, 91).toString('base64');

  function createService(): NotificationPayloadService {
    const configService = {
      getOrThrow: jest.fn((name: string) => {
        const values: Record<string, string> = {
          MOBILE_ENCRYPTION_KEY_V1: encryptionKeyBase64,
          MOBILE_ENCRYPTION_ACTIVE_KEY_ID: 'notification-test-v1',
        };

        const value = values[name];
        if (!value) {
          throw new Error(`Missing test configuration: ${name}`);
        }

        return value;
      }),
    };

    return new NotificationPayloadService(configService as ConfigService);
  }

  it('encrypts and decrypts a notification message without exposing plaintext in the envelope', () => {
    const service = createService();
    const message = 'Your clinic notification is ready.';

    const encrypted = service.encryptMessage(message);

    expect(encrypted).not.toContain(message);
    expect(encrypted).toMatch(
      /^v1\.notification-test-v1\.notification-outbox:message\./,
    );
    expect(service.decryptMessage(encrypted)).toBe(message);
  });

  it('uses a fresh IV so repeated encryption produces different protected values', () => {
    const service = createService();
    const message = 'Repeated message content.';

    const first = service.encryptMessage(message);
    const second = service.encryptMessage(message);

    expect(first).not.toBe(second);
    expect(service.decryptMessage(first)).toBe(message);
    expect(service.decryptMessage(second)).toBe(message);
  });

  it('rejects tampered ciphertext', () => {
    const service = createService();
    const encrypted = service.encryptMessage('Protected message.');
    const parts = encrypted.split('.');
    const ciphertext = parts[5];
    const replacement = ciphertext.endsWith('A') ? 'B' : 'A';

    parts[5] = ciphertext.slice(0, -1) + replacement;

    expect(() => service.decryptMessage(parts.join('.'))).toThrow(
      'Unable to decrypt protected notification message.',
    );
  });

  it('rejects an envelope for a different encryption purpose before decryption', () => {
    const service = createService();
    const encrypted = service.encryptMessage('Protected message.');
    const parts = encrypted.split('.');

    parts[2] = 'notification-outbox:other-purpose';

    expect(() => service.decryptMessage(parts.join('.'))).toThrow(
      'Invalid notification message encryption purpose.',
    );
  });

  it('rejects an envelope with an unknown key identifier', () => {
    const service = createService();
    const encrypted = service.encryptMessage('Protected message.');
    const parts = encrypted.split('.');

    parts[1] = 'unknown-key';

    expect(() => service.decryptMessage(parts.join('.'))).toThrow(
      'Unknown notification message encryption key.',
    );
  });
});
