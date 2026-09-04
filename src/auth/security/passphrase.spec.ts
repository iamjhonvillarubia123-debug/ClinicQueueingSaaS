import * as bcrypt from 'bcrypt';
import { PasswordSecurityService } from './password-security.service';

describe('Long passphrase compatibility', () => {
  const service = new PasswordSecurityService();
  it('rejects short, repeated and predictable passphrases', () => {
    for (const password of [
      'short',
      'a'.repeat(20),
      'passwordpassword',
      'x'.repeat(129),
    ])
      expect(() => service.assertStrong(password)).toThrow();
  });
  it('does not truncate differences after bcrypt’s byte limit', async () => {
    const prefix = 'This long passphrase includes Unicode 🦋 '.repeat(2);
    const hashed = await service.hashStrong(prefix + 'one');
    expect(await service.verify(prefix + 'one', hashed)).toBe(true);
    expect(await service.verify(prefix + 'two', hashed)).toBe(false);
  });
  it('still verifies existing bcrypt passwords', async () => {
    const legacyPassword = 'Existing password';
    const legacyHash = await bcrypt.hash(legacyPassword, 12);
    expect(await service.verify(legacyPassword, legacyHash)).toBe(true);
  });
});
