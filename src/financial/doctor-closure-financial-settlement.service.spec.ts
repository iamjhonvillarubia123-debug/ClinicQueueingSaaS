import { ConflictException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import {
  Prisma,
  SubscriptionCreditEntryType,
  SubscriptionPaymentStatus,
  SubscriptionPurchaseStatus,
} from '../../generated/prisma/client';
import { ProtectedAccountPayloadService } from '../auth/security/protected-account-payload.service';
import { DoctorClosureFinancialSettlementService } from './doctor-closure-financial-settlement.service';
import { SubscriptionPeriodService } from './subscription-period.service';

describe('DoctorClosureFinancialSettlementService', () => {
  let service: DoctorClosureFinancialSettlementService;

  const transaction = {
    $queryRaw: jest.fn(),
    subscriptionPurchase: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
    subscriptionPayment: {
      findFirst: jest.fn(),
    },
    doctorFinancialAccount: {
      update: jest.fn(),
    },
    subscriptionCreditEntry: {
      create: jest.fn(),
    },
  };
  const protectedPayload = {
    encrypt: jest.fn((value: string) => `enc:${value}`),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DoctorClosureFinancialSettlementService,
        SubscriptionPeriodService,
        {
          provide: ProtectedAccountPayloadService,
          useValue: protectedPayload,
        },
      ],
    }).compile();
    service = module.get(DoctorClosureFinancialSettlementService);
    jest.clearAllMocks();
    protectedPayload.encrypt.mockImplementation(
      (value: string) => `enc:${value}`,
    );
  });

  it('allows closure when no DoctorFinancialAccount exists', async () => {
    transaction.$queryRaw.mockResolvedValue([]);

    await expect(
      service.prepare(
        transaction as unknown as Prisma.TransactionClient,
        'doctor-1',
      ),
    ).resolves.toEqual({ doctorFinancialAccountId: null });

    expect(transaction.subscriptionPurchase.findFirst).not.toHaveBeenCalled();
  });

  it('blocks closure while a subscription purchase is pending', async () => {
    transaction.$queryRaw.mockResolvedValue([
      { id: 'financial-1', doctorUserId: 'doctor-1' },
    ]);
    transaction.subscriptionPurchase.findFirst.mockResolvedValue({
      id: 'purchase-1',
      status: SubscriptionPurchaseStatus.PENDING,
    });

    await expect(
      service.prepare(
        transaction as unknown as Prisma.TransactionClient,
        'doctor-1',
      ),
    ).rejects.toThrow(ConflictException);

    expect(transaction.subscriptionPayment.findFirst).not.toHaveBeenCalled();
  });

  it('blocks closure while an external subscription payment is pending', async () => {
    transaction.$queryRaw.mockResolvedValue([
      { id: 'financial-1', doctorUserId: 'doctor-1' },
    ]);
    transaction.subscriptionPurchase.findFirst.mockResolvedValue(null);
    transaction.subscriptionPayment.findFirst.mockResolvedValue({
      id: 'payment-1',
      status: SubscriptionPaymentStatus.PENDING,
    });

    await expect(
      service.prepare(
        transaction as unknown as Prisma.TransactionClient,
        'doctor-1',
      ),
    ).rejects.toThrow(ConflictException);
  });

  it('credits only fully unused future monthly periods at historical purchase price and snapshots recovery email', async () => {
    const closedAt = new Date('2026-08-21T12:00:00.000Z');
    transaction.subscriptionPurchase.findMany.mockResolvedValue([
      {
        id: 'purchase-current',
        monthsPurchased: 3,
        monthlyPriceSnapshot: new Prisma.Decimal('1000.00'),
        periodStart: new Date('2026-08-01T12:00:00.000Z'),
      },
      {
        id: 'purchase-future',
        monthsPurchased: 2,
        monthlyPriceSnapshot: new Prisma.Decimal('1200.00'),
        periodStart: new Date('2026-11-01T12:00:00.000Z'),
      },
    ]);
    transaction.doctorFinancialAccount.update.mockResolvedValue({});
    transaction.subscriptionCreditEntry.create.mockResolvedValue({});

    await expect(
      service.settle(transaction as unknown as Prisma.TransactionClient, {
        doctorFinancialAccountId: 'financial-1',
        recoveryEmail: ' Doctor@Example.com ',
        closureCommandId: 'command-1',
        closedAt,
      }),
    ).resolves.toEqual({
      doctorFinancialAccountId: 'financial-1',
      creditCreated: '4400.00',
      creditedFuturePeriods: 4,
    });

    expect(transaction.doctorFinancialAccount.update).toHaveBeenCalledWith({
      where: { id: 'financial-1' },
      data: {
        recoveryEmailEncrypted: 'enc:doctor@example.com',
        recoveryEmailHash: expect.any(String) as unknown,
      },
    });
    expect(transaction.subscriptionCreditEntry.create).toHaveBeenCalledTimes(1);
    expect(transaction.subscriptionCreditEntry.create).toHaveBeenCalledWith({
      data: {
        doctorFinancialAccountId: 'financial-1',
        entryType: SubscriptionCreditEntryType.CREDIT_CREATED,
        amount: new Prisma.Decimal('4400.00'),
        commandIdempotencyId: 'command-1',
        occurredAt: closedAt,
      },
    });
  });
});
