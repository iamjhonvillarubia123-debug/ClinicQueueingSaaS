import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SessionManagementService } from '../auth/session-management.service';
import { PasswordSecurityService } from '../auth/security/password-security.service';
import type { AuthenticatedUserContext } from '../auth/types/authenticated-request';

// Positive field lists: never serialize an unrestricted User or clinic relation.
const settingsSelect = {
  defaultTimeZone: true,
  defaultConsultationMinutes: true,
  maximumAdvanceBookingDays: true,
  allowOnlineBooking: true,
  noClinicOnRegularHolidays: true,
  maximumEstimatedServiceMinutesPerPatient: true,
} as const;
const accountSelect = {
  id: true,
  firstName: true,
  middleName: true,
  lastName: true,
  email: true,
  mobileNumber: true,
  role: true,
  accountStatus: true,
  emailVerifiedAt: true,
  createdAt: true,
} as const;

@Injectable()
export class DoctorAccountDataService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionManagementService,
    private readonly passwords: PasswordSecurityService,
  ) {}

  async inventory(actor: AuthenticatedUserContext) {
    return this.prisma.$transaction(async (tx) => {
      await this.sessions.validateActor(tx, actor);
      return {
        accountInformation: true,
        accountSettings: true,
        exportedCategories: [
          'Your account identity and contact information',
          'Your Doctor-wide settings',
          'Your retention-policy acknowledgements',
        ],
        excludedCategories: [
          'All patient and appointment records',
          'Booking answers and patient-linked queue data',
          'Other users’ personal information',
          'Passwords, authentication tokens and session secrets',
        ],
        erasureWorker: {
          status: 'UNKNOWN',
          lastSuccessfulRunAt: null,
          explanation:
            'Retention rules are implemented, but no durable worker heartbeat is recorded. This does not confirm that the worker is running or stopped.',
        },
      };
    });
  }

  async export(
    actor: AuthenticatedUserContext,
    currentPassword: string,
    settingsOnly: boolean,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const user = await this.sessions.validateActor(tx, actor);
      if (
        !currentPassword ||
        !(await this.passwords.verify(currentPassword, user.passwordHash))
      )
        throw new UnauthorizedException('Current password is incorrect.');
      await this.sessions.validateActor(tx, actor);
      const profile = await tx.doctorProfile.findUnique({
        where: { userId: actor.userId },
        select: { accountSettings: { select: settingsSelect } },
      });
      const account = settingsOnly
        ? undefined
        : await tx.user.findUnique({
            where: { id: actor.userId },
            select: accountSelect,
          });
      const acknowledgements = settingsOnly
        ? undefined
        : await tx.doctorDataRetentionAcknowledgement.findMany({
            where: { doctorUserId: actor.userId },
            select: { acknowledgementVersion: true, acknowledgedAt: true },
            orderBy: { acknowledgedAt: 'asc' },
          });
      return {
        formatVersion: 1,
        kind: settingsOnly ? 'ACCOUNT_SETTINGS_BACKUP' : 'ACCOUNT_EXPORT',
        generatedAt: new Date().toISOString(),
        account,
        settings: profile?.accountSettings ?? null,
        acknowledgements,
        patientDataIncluded: false,
        scope:
          'Account information only. No clinic, patient, appointment, queue, booking-answer or other-user records. This is not a full system backup and cannot be imported.',
      };
    });
  }
}
