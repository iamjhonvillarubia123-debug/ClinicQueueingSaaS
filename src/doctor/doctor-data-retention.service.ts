import { ForbiddenException, Injectable } from '@nestjs/common';
import {
  AdministrativeRestrictionStatus,
  Prisma,
  UserAccountStatus,
  UserRole,
} from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export const CURRENT_DOCTOR_RETENTION_ACKNOWLEDGEMENT_VERSION = 'phase6-v6.1';

const DATA_PRIVACY_PROFILE = Object.freeze({
  acknowledgementVersion: CURRENT_DOCTOR_RETENTION_ACKNOWLEDGEMENT_VERSION,
  jurisdiction: 'PHILIPPINES',
  terminalAppointmentIdentifiableRetentionHours: 24,
  permanentlyClosedAccountMinimizationDays: 7,
  patientIdentifiableHistoryIsPermanent: false,
  finalPrivacyErasureIsIrreversible: true,
  erasedVisitIdentityCanBeRecovered: false,
  anonymousAggregateQueueAnalyticsMayRemain: true,
  clinicRetentionExtensionConfigurable: false,
  clinicPermanentClinicalRecordResponsibility: true,
});

type TransactionClient = Prisma.TransactionClient;

type DoctorAuthority = {
  id: string;
  role: UserRole;
  accountStatus: UserAccountStatus;
  administrativeRestrictionStatus: AdministrativeRestrictionStatus;
};

@Injectable()
export class DoctorDataRetentionService {
  constructor(private readonly prisma: PrismaService) {}

  async getDataPrivacyProfile(doctorUserId: string) {
    await this.assertCurrentDoctor(this.prisma, doctorUserId);
    const acknowledgement =
      await this.prisma.doctorDataRetentionAcknowledgement.findUnique({
        where: {
          doctorUserId_acknowledgementVersion: {
            doctorUserId,
            acknowledgementVersion:
              CURRENT_DOCTOR_RETENTION_ACKNOWLEDGEMENT_VERSION,
          },
        },
        select: { acknowledgedAt: true },
      });

    return {
      ...DATA_PRIVACY_PROFILE,
      currentAcknowledgementSatisfied: Boolean(acknowledgement),
      acknowledgedAt: acknowledgement?.acknowledgedAt ?? null,
    };
  }

  async acknowledgeCurrentPolicy(doctorUserId: string) {
    await this.assertCurrentDoctor(this.prisma, doctorUserId);
    const acknowledgement =
      await this.prisma.doctorDataRetentionAcknowledgement.upsert({
        where: {
          doctorUserId_acknowledgementVersion: {
            doctorUserId,
            acknowledgementVersion:
              CURRENT_DOCTOR_RETENTION_ACKNOWLEDGEMENT_VERSION,
          },
        },
        update: {},
        create: {
          doctorUserId,
          acknowledgementVersion:
            CURRENT_DOCTOR_RETENTION_ACKNOWLEDGEMENT_VERSION,
          acknowledgedAt: new Date(),
        },
        select: {
          acknowledgementVersion: true,
          acknowledgedAt: true,
        },
      });

    return {
      acknowledged: true,
      ...acknowledgement,
    };
  }

  async assertCurrentAcknowledgement(
    transaction: TransactionClient,
    doctorUserId: string,
  ): Promise<void> {
    await this.assertCurrentDoctor(transaction, doctorUserId);
    const acknowledgement =
      await transaction.doctorDataRetentionAcknowledgement.findUnique({
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
        'Current Data Retention Acknowledgement is required before patient operations.',
      );
    }
  }

  private async assertCurrentDoctor(
    client: Pick<PrismaService, 'user'> | TransactionClient,
    doctorUserId: string,
  ): Promise<void> {
    const doctor: DoctorAuthority | null = await client.user.findUnique({
      where: { id: doctorUserId },
      select: {
        id: true,
        role: true,
        accountStatus: true,
        administrativeRestrictionStatus: true,
      },
    });

    if (
      !doctor ||
      doctor.role !== UserRole.DOCTOR ||
      doctor.accountStatus !== UserAccountStatus.ACTIVE ||
      doctor.administrativeRestrictionStatus !==
        AdministrativeRestrictionStatus.NONE
    ) {
      throw new ForbiddenException('Active Doctor authority is required.');
    }
  }
}
