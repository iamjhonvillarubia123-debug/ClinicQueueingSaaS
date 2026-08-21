import { BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AccountAdministrativeRetentionService } from './account-administrative-retention.service';

describe('AccountAdministrativeRetentionService', () => {
  const transaction = {
    $queryRaw: jest.fn(),
    user: {
      updateMany: jest.fn(),
    },
    accountPermanentClosureAudit: {
      count: jest.fn(),
    },
    administrativeAccountAction: {
      count: jest.fn(),
    },
  };
  const prisma = {
    $transaction: jest.fn(
      async (callback: (tx: typeof transaction) => Promise<unknown>) =>
        callback(transaction),
    ),
  };
  const service = new AccountAdministrativeRetentionService(
    prisma as unknown as PrismaService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    transaction.$queryRaw.mockResolvedValue([]);
    transaction.user.updateMany.mockResolvedValue({ count: 0 });
    transaction.accountPermanentClosureAudit.count.mockResolvedValue(0);
    transaction.administrativeAccountAction.count.mockResolvedValue(0);
  });

  it('rejects an invalid cleanup batch size', async () => {
    await expect(service.run(new Date(), 0)).rejects.toThrow(
      BadRequestException,
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('minimizes eligible closed User identity and reports five-year audit boundaries without deleting audit evidence', async () => {
    transaction.$queryRaw.mockResolvedValue([{ userId: 'closed-user-1' }]);
    transaction.user.updateMany.mockResolvedValue({ count: 1 });
    transaction.accountPermanentClosureAudit.count.mockResolvedValue(3);
    transaction.administrativeAccountAction.count.mockResolvedValue(4);

    await expect(
      service.run(new Date('2026-08-21T12:00:00.000Z'), 50),
    ).resolves.toEqual({
      closedUsersMinimized: 1,
      closureAuditsAtBaseline: 3,
      administrativeActionsAtBaseline: 4,
    });

    expect(transaction.user.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'closed-user-1',
        accountStatus: 'PERMANENTLY_CLOSED',
      },
      data: {
        email: expect.stringMatching(/^closed-[a-f0-9]{20}@invalid\.local$/),
        firstName: 'Closed',
        middleName: null,
        lastName: 'Account',
        mobileNumber: expect.stringMatching(/^closed-[a-f0-9]{20}$/),
        passwordHash: expect.stringMatching(/^!closed:[a-f0-9]{20}$/),
        emailVerifiedAt: null,
        lastLoginAt: null,
      },
    });
    expect(transaction.accountPermanentClosureAudit.count).toHaveBeenCalledWith(
      {
        where: {
          occurredAt: { lte: new Date('2021-08-21T12:00:00.000Z') },
        },
      },
    );
    expect(transaction.administrativeAccountAction.count).toHaveBeenCalledWith(
      {
        where: {
          occurredAt: { lte: new Date('2021-08-21T12:00:00.000Z') },
        },
      },
    );
  });

  it('is a no-op when no closed User requires minimization', async () => {
    await expect(
      service.run(new Date('2026-08-21T12:00:00.000Z')),
    ).resolves.toEqual({
      closedUsersMinimized: 0,
      closureAuditsAtBaseline: 0,
      administrativeActionsAtBaseline: 0,
    });

    expect(transaction.user.updateMany).not.toHaveBeenCalled();
  });
});
