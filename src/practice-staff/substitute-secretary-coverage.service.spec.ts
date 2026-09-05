import { createHash } from 'crypto';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import {
  AdministrativeRestrictionStatus,
  PracticeLocationLifecycleStatus,
  PracticeStaffRole,
  UserAccountStatus,
  UserRole,
} from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SubstituteSecretaryCoverageService } from './substitute-secretary-coverage.service';
import { SubstituteSecretaryCoverageMode } from './substitute-secretary-coverage.types';

type CoverageNormalizer = {
  normalizeCoverage(dto: {
    coverageMode: SubstituteSecretaryCoverageMode;
    fromServiceDate: string;
    toServiceDate: string;
  }): { serviceDates: string[] };
};

describe('SubstituteSecretaryCoverageService', () => {
  const transaction = {
    $executeRaw: jest.fn(),
    $queryRaw: jest.fn(),
    user: { findUnique: jest.fn() },
  };
  const prisma = {
    $transaction: jest.fn(
      async (callback: (tx: typeof transaction) => Promise<unknown>) =>
        callback(transaction),
    ),
  };
  const service = new SubstituteSecretaryCoverageService(
    prisma as unknown as PrismaService,
  );
  const normalizer = service as unknown as CoverageNormalizer;

  beforeEach(() => {
    jest.clearAllMocks();
    transaction.$executeRaw.mockResolvedValue(1);
  });

  it('accepts one Service Date and enumerates it exactly once', () => {
    expect(
      normalizer.normalizeCoverage({
        coverageMode: SubstituteSecretaryCoverageMode.ONE_SERVICE_DATE,
        fromServiceDate: '2026-08-31',
        toServiceDate: '2026-08-31',
      }).serviceDates,
    ).toEqual(['2026-08-31']);
  });

  it('enumerates an inclusive Service-Date range', () => {
    expect(
      normalizer.normalizeCoverage({
        coverageMode: SubstituteSecretaryCoverageMode.DATE_RANGE,
        fromServiceDate: '2026-08-30',
        toServiceDate: '2026-09-01',
      }).serviceDates,
    ).toEqual(['2026-08-30', '2026-08-31', '2026-09-01']);
  });

  it('rejects reversed and malformed Service-Date ranges', () => {
    expect(() =>
      normalizer.normalizeCoverage({
        coverageMode: SubstituteSecretaryCoverageMode.DATE_RANGE,
        fromServiceDate: '2026-09-01',
        toServiceDate: '2026-08-31',
      }),
    ).toThrow(BadRequestException);
    expect(() =>
      normalizer.normalizeCoverage({
        coverageMode: SubstituteSecretaryCoverageMode.ONE_SERVICE_DATE,
        fromServiceDate: '2026-02-30',
        toServiceDate: '2026-02-30',
      }),
    ).toThrow(BadRequestException);
  });

  it('creates inclusive range rows without creating ClinicDay rows', async () => {
    transaction.$queryRaw
      .mockResolvedValueOnce([
        {
          id: 'location-1',
          doctorUserId: 'doctor-1',
          lifecycleStatus: PracticeLocationLifecycleStatus.ACTIVE,
        },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 'staff-1',
          userId: 'secretary-1',
          practiceLocationId: 'location-1',
          staffRole: PracticeStaffRole.SECRETARY,
          isActive: true,
        },
      ])
      .mockResolvedValueOnce([]);
    transaction.user.findUnique
      .mockResolvedValueOnce({
        id: 'doctor-1',
        role: UserRole.DOCTOR,
        accountStatus: UserAccountStatus.ACTIVE,
        administrativeRestrictionStatus: AdministrativeRestrictionStatus.NONE,
        emailVerifiedAt: new Date(),
      })
      .mockResolvedValueOnce({
        id: 'secretary-1',
        role: UserRole.SECRETARY,
        accountStatus: UserAccountStatus.ACTIVE,
        administrativeRestrictionStatus: AdministrativeRestrictionStatus.NONE,
        emailVerifiedAt: new Date(),
      });

    await expect(
      service.create(
        'doctor-1',
        {
          practiceLocationId: 'location-1',
          userId: 'secretary-1',
          coverageMode: SubstituteSecretaryCoverageMode.DATE_RANGE,
          fromServiceDate: '2026-08-30',
          toServiceDate: '2026-09-01',
        },
        'coverage-range-key',
      ),
    ).resolves.toMatchObject({
      created: true,
      replayed: false,
      fromServiceDate: '2026-08-30',
      toServiceDate: '2026-09-01',
    });

    // Two advisory locks, one coverage row, three inclusive date rows, one command row.
    expect(transaction.$executeRaw).toHaveBeenCalledTimes(7);
    expect(transaction).not.toHaveProperty('clinicDay');
  });

  it('rejects a Secretary without an active clinic assignment', async () => {
    transaction.$queryRaw
      .mockResolvedValueOnce([
        {
          id: 'location-1',
          doctorUserId: 'doctor-1',
          lifecycleStatus: PracticeLocationLifecycleStatus.ACTIVE,
        },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    transaction.user.findUnique
      .mockResolvedValueOnce({
        id: 'doctor-1',
        role: UserRole.DOCTOR,
        accountStatus: UserAccountStatus.ACTIVE,
        administrativeRestrictionStatus: AdministrativeRestrictionStatus.NONE,
        emailVerifiedAt: new Date(),
      })
      .mockResolvedValueOnce({
        id: 'secretary-1',
        role: UserRole.SECRETARY,
        accountStatus: UserAccountStatus.ACTIVE,
        administrativeRestrictionStatus: AdministrativeRestrictionStatus.NONE,
        emailVerifiedAt: new Date(),
      });

    await expect(
      service.create(
        'doctor-1',
        {
          practiceLocationId: 'location-1',
          userId: 'secretary-1',
          coverageMode: SubstituteSecretaryCoverageMode.ONE_SERVICE_DATE,
          fromServiceDate: '2026-08-31',
          toServiceDate: '2026-08-31',
        },
        'coverage-not-ready-key',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('returns the authoritative coverage on an idempotent replay without duplicating rows', async () => {
    const request = {
      practiceLocationId: 'location-1',
      userId: 'secretary-1',
      coverageMode: SubstituteSecretaryCoverageMode.ONE_SERVICE_DATE,
      fromServiceDate: '2026-08-31',
      toServiceDate: '2026-08-31',
    };
    transaction.$queryRaw
      .mockResolvedValueOnce([
        {
          id: 'location-1',
          doctorUserId: 'doctor-1',
          lifecycleStatus: PracticeLocationLifecycleStatus.ACTIVE,
        },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          requestFingerprint: createHash('sha256')
            .update(
              'PRACTICE_LOCATION_CREATE_SUBSTITUTE_COVERAGE|doctor-1|location-1|secretary-1|ONE_SERVICE_DATE|2026-08-31|2026-08-31',
              'utf8',
            )
            .digest('hex'),
          resultSubstituteSecretaryCoverageId: 'coverage-authoritative',
        },
      ]);
    transaction.user.findUnique
      .mockResolvedValueOnce({
        id: 'doctor-1',
        role: UserRole.DOCTOR,
        accountStatus: UserAccountStatus.ACTIVE,
        administrativeRestrictionStatus: AdministrativeRestrictionStatus.NONE,
        emailVerifiedAt: new Date(),
      })
      .mockResolvedValueOnce({
        id: 'secretary-1',
        role: UserRole.SECRETARY,
        accountStatus: UserAccountStatus.ACTIVE,
        administrativeRestrictionStatus: AdministrativeRestrictionStatus.NONE,
        emailVerifiedAt: new Date(),
      });

    await expect(
      service.create('doctor-1', request, 'coverage-replay-key'),
    ).resolves.toEqual({
      created: true,
      replayed: true,
      coverageId: 'coverage-authoritative',
    });
    expect(transaction.$executeRaw).toHaveBeenCalledTimes(2);
  });
});
