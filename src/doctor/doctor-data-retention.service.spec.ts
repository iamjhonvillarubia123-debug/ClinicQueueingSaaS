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
    prisma.doctorDataRetentionAcknowledgement.findUnique.mockResolvedValue(null);

    await expect(service.getDataPrivacyProfile('doctor-1')).resolves.toEqual(
      expect.objectContaining({
        acknowledgementVersion:
          CURRENT_DOCTOR_RETENTION_ACKNOWLEDGEMENT_VERSION,
        jurisdiction: 'PHILIPPINES',
        terminalAppointmentIdentifiableRetentionHours: 24,
        finalPrivacyErasureIsIrreversible: true,
        erasedVisitIdentityCanBeRecovered: false,
        currentAcknowledgementSatisfied: false,
        acknowledgedAt: null,
      }),
    );
  });

  it('records the current acknowledgement idempotently through the version key', async () => {
    const acknowledgedAt = new Date('2026-08-21T12:00:00.000Z');
    prisma.doctorDataRetentionAcknowledgement.upsert.mockResolvedValue({
      acknowledgementVersion:
        CURRENT_DOCTOR_RETENTION_ACKNOWLEDGEMENT_VERSION,
      acknowledgedAt,
    });

    await expect(service.acknowledgeCurrentPolicy('doctor-1')).resolves.toEqual(
      {
        acknowledged: true,
        acknowledgementVersion:
          CURRENT_DOCTOR_RETENTION_ACKNOWLEDGEMENT_VERSION,
        acknowledgedAt,
      },
    );
    expect(
      prisma.doctorDataRetentionAcknowledgement.upsert,
    ).toHaveBeenCalledTimes(1);
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
    prisma.doctorDataRetentionAcknowledgement.findUnique.mockResolvedValue(null);

    await expect(
      service.assertCurrentAcknowledgement(prisma as never, 'doctor-1'),
    ).rejects.toThrow('Current Data Retention Acknowledgement is required');
  });
});
