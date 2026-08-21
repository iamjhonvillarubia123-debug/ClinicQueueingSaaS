import { ForbiddenException, Injectable } from '@nestjs/common';
import { CURRENT_DOCTOR_RETENTION_ACKNOWLEDGEMENT_VERSION } from '../doctor/doctor-data-retention.service';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PracticeLocationDataRetentionGateService {
  constructor(private readonly prisma: PrismaService) {}

  async assertCurrentAcknowledgement(doctorUserId: string): Promise<void> {
    const acknowledgement =
      await this.prisma.doctorDataRetentionAcknowledgement.findUnique({
        where: {
          doctorUserId_acknowledgementVersion: {
            doctorUserId,
            acknowledgementVersion:
              CURRENT_DOCTOR_RETENTION_ACKNOWLEDGEMENT_VERSION,
          },
        },
        select: { id: true },
      });

    if (!acknowledgement) {
      throw new ForbiddenException(
        'Current Data Retention Acknowledgement is required before practice activation.',
      );
    }
  }
}
