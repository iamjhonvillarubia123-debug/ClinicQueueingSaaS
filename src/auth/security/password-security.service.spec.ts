import { BadRequestException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PasswordSecurityService } from './password-security.service';

jest.mock('bcrypt', () => ({ hash: jest.fn() }));
const bcryptHash = bcrypt.hash as jest.MockedFunction<typeof bcrypt.hash>;

describe('PasswordSecurityService', () => {
  const service = new PasswordSecurityService();

  beforeEach(() => jest.clearAllMocks());

  it('rejects a blank password under the shared policy', () => {
    expect(() => service.assertValid('   ')).toThrow(BadRequestException);
  });

  it('hashes an accepted password with the shared bcrypt work factor', async () => {
    bcryptHash.mockResolvedValue('hashed' as never);
    await expect(service.hash('Valid password')).resolves.toBe('hashed');
    expect(bcryptHash).toHaveBeenCalledWith('Valid password', 12);
  });
});
