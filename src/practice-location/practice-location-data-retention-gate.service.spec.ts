import { ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PracticeLocationDataRetentionGateService } from './practice-location-data-retention-gate.service';

describe('PracticeLocationDataRetentionGateService', () => {
  const prisma = {
    doctorDataRetentionAcknowledgement: {
      findUnique: jest.fn(),
    },
  };
  const service = new PracticeLocationDataRetentionGateService(
    prisma as unknown as PrismaService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('allows practice activation after current Doctor acknowledgement', async () => {
    prisma.doctorDataRetentionAcknowledgement.findUnique.mockResolvedValue({
      id: 'ack-1',
    });

    await expect(
      service.assertCurrentAcknowledgement('doctor-1'),
    ).resolves.toBeUndefined();
  });

  it('blocks practice activation until current Doctor acknowledgement exists', async () => {
    prisma.doctorDataRetentionAcknowledgement.findUnique.mockResolvedValue(
      null,
    );

    await expect(
      service.assertCurrentAcknowledgement('doctor-1'),
    ).rejects.toThrow(ForbiddenException);
  });
});
