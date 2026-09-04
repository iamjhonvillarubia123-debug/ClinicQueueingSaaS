import { UserRole } from '../../generated/prisma/client';
import { AccountAnnouncementService } from './account-announcement.service';
import { PasswordSecurityService } from '../auth/security/password-security.service';
import { PrismaService } from '../prisma/prisma.service';
describe('Trusted account announcement publishing', () => {
  const tx = {
    $queryRaw: jest.fn(),
    user: { findUnique: jest.fn(), findMany: jest.fn() },
    userSession: { findFirst: jest.fn() },
    applicationNotification: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      createMany: jest.fn(),
    },
  };
  const prisma = {
    $transaction: jest.fn((fn: (client: typeof tx) => unknown) => fn(tx)),
  };
  const passwords = { verify: jest.fn() };
  const service = new AccountAnnouncementService(
    prisma as unknown as PrismaService,
    passwords as unknown as PasswordSecurityService,
  );
  const actor = {
    userId: 'admin',
    role: UserRole.SYSTEM_ADMIN,
    sessionId: 'current',
  };
  beforeEach(() => {
    jest.clearAllMocks();
    tx.user.findUnique.mockResolvedValue({
      role: 'SYSTEM_ADMIN',
      accountStatus: 'ACTIVE',
      administrativeRestrictionStatus: 'NONE',
      passwordHash: 'hash',
    });
    tx.user.findMany.mockResolvedValue([{ id: 'recipient' }]);
    tx.userSession.findFirst.mockResolvedValue({ id: 'current' });
    tx.applicationNotification.findMany.mockResolvedValue([]);
    tx.applicationNotification.findUnique.mockResolvedValue(null);
    passwords.verify.mockResolvedValue(true);
  });
  it('never allows a Doctor to publish to another account', async () => {
    await expect(
      service.publish(
        { ...actor, role: UserRole.DOCTOR },
        ['recipient'],
        'Update',
        'Message',
        'password',
        'key',
      ),
    ).rejects.toThrow('administrator');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
  it('requires fresh administrator credentials before reading recipients or sending', async () => {
    passwords.verify.mockResolvedValue(false);
    await expect(
      service.publish(
        actor,
        ['recipient'],
        'Update',
        'Message',
        'wrong',
        'key',
      ),
    ).rejects.toThrow('incorrect');
    expect(tx.user.findMany).not.toHaveBeenCalled();
    expect(tx.applicationNotification.createMany).not.toHaveBeenCalled();
  });
  it('records only the selected recipients and rejects idempotency changes', async () => {
    await expect(
      service.publish(
        actor,
        ['recipient'],
        'Update',
        'Message',
        'password',
        'key',
      ),
    ).resolves.toEqual({ published: 1, replayed: false });
    const call = (
      tx.applicationNotification.createMany.mock.calls as unknown[][]
    )[0][0] as { data: { recipientUserId: string }[] };
    expect(call.data.map((item) => item.recipientUserId)).toEqual([
      'recipient',
    ]);
    tx.applicationNotification.findUnique.mockResolvedValue({
      message: 'different-fingerprint',
    });
    await expect(
      service.publish(
        actor,
        ['recipient'],
        'Different',
        'Message',
        'password',
        'key',
      ),
    ).rejects.toThrow('different');
  });
});
