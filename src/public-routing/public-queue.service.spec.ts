import { NotFoundException } from '@nestjs/common';
import { SubscriptionEntitlementService } from '../financial/subscription-entitlement.service';
import { PrismaService } from '../prisma/prisma.service';
import { PublicQueueService } from './public-queue.service';

describe('PublicQueueService', () => {
  const prisma = {
    practiceLocation: { findUnique: jest.fn() },
    clinicDay: { findUnique: jest.fn() },
    $queryRaw: jest.fn(),
  };
  const subscriptionEntitlement = {
    evaluateForFinancialAccount: jest.fn(),
  };
  const service = new PublicQueueService(
    prisma as unknown as PrismaService,
    subscriptionEntitlement as unknown as SubscriptionEntitlementService,
  );

  beforeEach(() => {
    jest.resetAllMocks();
  });

  const location = (overrides: Record<string, unknown> = {}) => ({
    id: 'location-id',
    publicIdentifier: 'location-public-id',
    lifecycleStatus: 'ACTIVE',
    name: 'Main Clinic',
    doctorProfile: {
      user: {
        accountStatus: 'ACTIVE',
        administrativeRestrictionStatus: 'NONE',
        doctorFinancialAccount: { id: 'financial-account-id' },
      },
    },
    ...overrides,
  });

  const allowSubscription = () =>
    subscriptionEntitlement.evaluateForFinancialAccount.mockResolvedValue({
      allowsNewSubscriptionGatedActivity: true,
    });

  it('returns only approved public live queue fields from authoritative state', async () => {
    prisma.practiceLocation.findUnique.mockResolvedValue(location());
    allowSubscription();
    prisma.clinicDay.findUnique.mockResolvedValue({ status: 'STARTED' });
    prisma.$queryRaw.mockResolvedValue([{ queueNumber: 12 }]);

    const result = await service.getPublicQueue(
      'location-public-id',
      '2026-08-21',
    );

    expect(result).toEqual({
      publicIdentifier: 'location-public-id',
      practiceLocationName: 'Main Clinic',
      serviceDate: '2026-08-21',
      status: 'AVAILABLE',
      message: null,
      clinicDayStatus: 'STARTED',
      nowServingQueueNumber: 12,
    });
    expect(JSON.stringify(result)).not.toContain('patient');
    expect(JSON.stringify(result)).not.toContain('bookingReference');
  });

  it('uses the approved neutral message while subscription activity is suspended', async () => {
    prisma.practiceLocation.findUnique.mockResolvedValue(location());
    subscriptionEntitlement.evaluateForFinancialAccount.mockResolvedValue({
      allowsNewSubscriptionGatedActivity: false,
    });

    const result = await service.getPublicQueue(
      'location-public-id',
      '2026-08-21',
    );

    expect(result.status).toBe('TEMPORARILY_UNAVAILABLE');
    expect(result.message).toBe(
      'The online queue display is temporarily unavailable. Please try again later.',
    );
    expect(result.nowServingQueueNumber).toBeNull();
    expect(prisma.clinicDay.findUnique).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain('billing');
    expect(JSON.stringify(result)).not.toContain('SUSPENDED');
  });

  it('removes live queue numbers after clinic closure', async () => {
    prisma.practiceLocation.findUnique.mockResolvedValue(location());
    allowSubscription();
    prisma.clinicDay.findUnique.mockResolvedValue({ status: 'CLOSED' });

    const result = await service.getPublicQueue(
      'location-public-id',
      '2026-08-21',
    );

    expect(result.message).toBe("TODAY'S QUEUE HAS ENDED");
    expect(result.nowServingQueueNumber).toBeNull();
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('does not resolve a permanently deleted PracticeLocation public queue', async () => {
    prisma.practiceLocation.findUnique.mockResolvedValue(
      location({ lifecycleStatus: 'PERMANENTLY_DELETED' }),
    );

    await expect(
      service.getPublicQueue('location-public-id', '2026-08-21'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
