import { BadRequestException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PasswordSecurityService } from './password-security.service';

jest.mock('bcrypt', () => ({ hash: jest.fn() }));
const bcryptHash = bcrypt.hash as jest.MockedFunction<typeof bcrypt.hash>;

describe('PasswordSecurityService', () => {
  const service = new PasswordSecurityService();

  beforeEach(() => jest.clearAllMocks());

  it.each([
    ['blank', '        '],
    ['too short', 'Aa1!aaa'],
    ['uppercase', 'example1!'],
    ['lowercase', 'EXAMPLE1!'],
    ['number', 'Example!'],
    ['special character', 'Example1'],
  ])('rejects a password missing the shared %s requirement', (_requirement, password) => {
    expect(() => service.assertValid(password)).toThrow(BadRequestException);
  });

  it('hashes an accepted password with the shared bcrypt work factor', async () => {
    bcryptHash.mockResolvedValue('hashed' as never);
    await expect(service.hash('ExamplePass1!')).resolves.toBe('hashed');
    expect(bcryptHash).toHaveBeenCalledWith('ExamplePass1!', 12);
  });
});
