import { ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  CURRENT_DOCTOR_RETENTION_ACKNOWLEDGEMENT_VERSION,
  DoctorDataRetentionService,
} from './doctor-data-retention.service';

describe('DoctorDataRetentionService', () => {
  const prisma = {
    user: {
      findUnique: jest.fn(),
    },
    doctorDataRetentionAcknowledgement: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
  };
  const service = new DoctorDataRetentionService(
    prisma as unknown as PrismaService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.user.findUnique.mockResolvedValue({
      id: 'doctor-1',
      role: 'DOCTOR',
      accountStatus: 'ACTIVE',
      administrativeRestrictionStatus: 'NONE',
    });
  });

  it('returns the current privacy profile and missing acknowledgement state', async () => {
    const findAcknowledgement =
      prisma.doctorDataRetentionAcknowledgement.findUnique;
    findAcknowledgement.mockResolvedValue(null);

    const result = await service.getDataPrivacyProfile('doctor-1');

    expect(result.acknowledgementVersion).toBe(
      CURRENT_DOCTOR_RETENTION_ACKNOWLEDGEMENT_VERSION,
    );
    expect(result.jurisdiction).toBe('PHILIPPINES');
    expect(result.terminalAppointmentIdentifiableRetentionHours).toBe(24);
    expect(result.finalPrivacyErasureIsIrreversible).toBe(true);
    expect(result.erasedVisitIdentityCanBeRecovered).toBe(false);
    expect(result.currentAcknowledgementSatisfied).toBe(false);
    expect(result.acknowledgedAt).toBeNull();
  });

  it('records the current acknowledgement idempotently through the version key', async () => {
    const acknowledgedAt = new Date('2026-08-21T12:00:00.000Z');
    const upsertAcknowledgement =
      prisma.doctorDataRetentionAcknowledgement.upsert;
    upsertAcknowledgement.mockResolvedValue({
      acknowledgementVersion:
        CURRENT_DOCTOR_RETENTION_ACKNOWLEDGEMENT_VERSION,
      acknowledgedAt,
    });

    const result = await service.acknowledgeCurrentPolicy('doctor-1');

    expect(result.acknowledged).toBe(true);
    expect(result.acknowledgementVersion).toBe(
      CURRENT_DOCTOR_RETENTION_ACKNOWLEDGEMENT_VERSION,
    );
    expect(result.acknowledgedAt).toEqual(acknowledgedAt);
    expect(upsertAcknowledgement).toHaveBeenCalledTimes(1);
  });

  it('rejects acknowledgement access without current unrestricted Doctor authority', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'doctor-1',
      role: 'DOCTOR',
      accountStatus: 'VOLUNTARILY_DISABLED',
      administrativeRestrictionStatus: 'NONE',
    });

    await expect(service.getDataPrivacyProfile('doctor-1')).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('blocks patient operations until the current acknowledgement exists', async () => {
    const findAcknowledgement =
      prisma.doctorDataRetentionAcknowledgement.findUnique;
    findAcknowledgement.mockResolvedValue(null);

    const assertion = service.assertCurrentAcknowledgement(
      prisma as never,
      'doctor-1',
    );

    await expect(assertion).rejects.toThrow(
      'Current Data Retention Acknowledgement is required',
    );
  });
});
