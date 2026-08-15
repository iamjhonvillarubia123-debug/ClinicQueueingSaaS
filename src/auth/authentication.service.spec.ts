import { Test, TestingModule } from '@nestjs/testing';
import {
  AdministrativeRestrictionStatus,
  UserAccountStatus,
  UserRole,
} from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthenticationService } from './authentication.service';
import {
  hashSessionToken,
  SESSION_IDLE_LIFETIME_MS,
  SESSION_TOUCH_THROTTLE_MS,
} from './security/session-security';

type SessionUpdateManyArgs = {
  data: { lastSeenAt: Date; idleExpiresAt: Date };
};

describe('AuthenticationService', () => {
  let service: AuthenticationService;
  const prismaServiceMock = {
    userSession: {
      findUnique: jest.fn(),
      updateMany: jest.fn((args: SessionUpdateManyArgs) =>
        Promise.resolve({ count: args ? 1 : 0 }),
      ),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthenticationService,
        { provide: PrismaService, useValue: prismaServiceMock },
      ],
    }).compile();
    service = module.get(AuthenticationService);
    jest.clearAllMocks();
  });

  const validSession = () => ({
    id: 'session-1',
    lastSeenAt: new Date(Date.now() - SESSION_TOUCH_THROTTLE_MS - 1000),
    idleExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
    expiresAt: new Date(Date.now() + 6 * 60 * 60 * 1000),
    revokedAt: null,
    user: {
      id: 'user-1',
      role: UserRole.DOCTOR,
      accountStatus: UserAccountStatus.ACTIVE,
      administrativeRestrictionStatus: AdministrativeRestrictionStatus.NONE,
    },
  });

  it('hashes token for lookup and returns current user identity', async () => {
    prismaServiceMock.userSession.findUnique.mockResolvedValue(validSession());
    prismaServiceMock.userSession.updateMany.mockResolvedValue({ count: 1 });
    const context = await service.authenticateOrdinarySession('raw-token');
    expect(prismaServiceMock.userSession.findUnique).toHaveBeenCalledWith({
      where: { tokenHash: hashSessionToken('raw-token') },
      include: { user: true },
    });
    expect(context).toEqual({
      userId: 'user-1',
      role: UserRole.DOCTOR,
      sessionId: 'session-1',
    });
  });

  it.each([
    ['revoked', { revokedAt: new Date() }],
    ['idle expired', { idleExpiresAt: new Date(Date.now() - 1000) }],
    ['absolute expired', { expiresAt: new Date(Date.now() - 1000) }],
  ])('rejects a %s session', async (_label, override) => {
    prismaServiceMock.userSession.findUnique.mockResolvedValue({
      ...validSession(),
      ...override,
    });
    await expect(
      service.authenticateOrdinarySession('raw-token'),
    ).rejects.toThrow('Authentication required.');
    expect(prismaServiceMock.userSession.updateMany).not.toHaveBeenCalled();
  });

  it('rejects stale session when current doctor becomes administratively restricted', async () => {
    const session = validSession();
    prismaServiceMock.userSession.findUnique.mockResolvedValue({
      ...session,
      user: {
        ...session.user,
        administrativeRestrictionStatus:
          AdministrativeRestrictionStatus.SUSPENDED,
      },
    });
    await expect(
      service.authenticateOrdinarySession('raw-token'),
    ).rejects.toThrow('Authentication required.');
    expect(prismaServiceMock.userSession.updateMany).not.toHaveBeenCalled();
  });

  it('extends idle expiry on eligible activity but never beyond absolute expiry', async () => {
    const session = validSession();
    const absoluteExpiry = new Date(Date.now() + 30 * 60 * 1000);
    prismaServiceMock.userSession.findUnique.mockResolvedValue({
      ...session,
      expiresAt: absoluteExpiry,
    });
    prismaServiceMock.userSession.updateMany.mockResolvedValue({ count: 1 });

    await service.authenticateOrdinarySession('raw-token');

    const updateData =
      prismaServiceMock.userSession.updateMany.mock.calls[0][0].data;
    expect(updateData.idleExpiresAt.getTime()).toBe(absoluteExpiry.getTime());
    expect(
      updateData.idleExpiresAt.getTime() - updateData.lastSeenAt.getTime(),
    ).toBeLessThanOrEqual(SESSION_IDLE_LIFETIME_MS);
  });

  it('throttles persistence touches well below the two-hour idle window', async () => {
    const session = validSession();
    prismaServiceMock.userSession.findUnique.mockResolvedValue({
      ...session,
      lastSeenAt: new Date(
        Date.now() - Math.floor(SESSION_TOUCH_THROTTLE_MS / 2),
      ),
    });

    await service.authenticateOrdinarySession('raw-token');

    expect(prismaServiceMock.userSession.updateMany).not.toHaveBeenCalled();
  });
});
