import { Test, TestingModule } from '@nestjs/testing';
import {
  AdministrativeRestrictionStatus,
  UserAccountStatus,
  UserRole,
} from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthenticationService } from './authentication.service';
import { hashSessionToken } from './security/session-security';

describe('AuthenticationService', () => {
  let service: AuthenticationService;
  const prismaServiceMock = {
    userSession: { findUnique: jest.fn(), updateMany: jest.fn() },
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
    lastSeenAt: new Date(Date.now() - 10 * 60 * 1000),
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

  it('rejects a revoked session', async () => {
    prismaServiceMock.userSession.findUnique.mockResolvedValue({
      ...validSession(),
      revokedAt: new Date(),
    });
    await expect(
      service.authenticateOrdinarySession('raw-token'),
    ).rejects.toThrow('Authentication required.');
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
  });
});
