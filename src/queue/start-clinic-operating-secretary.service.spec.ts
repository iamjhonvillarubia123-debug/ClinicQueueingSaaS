import { ForbiddenException } from '@nestjs/common';
import {
  AdministrativeRestrictionStatus,
  PracticeLocationLifecycleStatus,
  UserAccountStatus,
  UserRole,
} from '../../generated/prisma/client';
import { SubscriptionCommercialGateService } from '../financial/subscription-commercial-gate.service';
import { CommandIdempotencyService } from '../idempotency/command-idempotency.service';
import { PrismaService } from '../prisma/prisma.service';
import { ScheduleResolutionService } from '../schedule/schedule-resolution.service';
import { ScheduleTimeService } from '../schedule/schedule-time.service';
import { StartClinicService } from './start-clinic.service';

type AuthorityResolver = {
  assertActorAuthorityAndResolveOperatingStaff: (
    transaction: unknown,
    context: {
      practiceLocationId: string;
      lifecycleStatus: PracticeLocationLifecycleStatus;
      doctorUserId: string;
    },
    clinicDay: {
      id: string;
      status: string;
      operatingPracticeStaffId: string | null;
    } | null,
    actor: {
      id: string;
      role: UserRole;
      accountStatus: UserAccountStatus;
      administrativeRestrictionStatus: AdministrativeRestrictionStatus;
    },
  ) => Promise<string | null>;
};

describe('StartClinicService operating secretary authority', () => {
  const service = new StartClinicService(
    {} as PrismaService,
    {} as CommandIdempotencyService,
    {} as ScheduleResolutionService,
    {} as ScheduleTimeService,
    {} as SubscriptionCommercialGateService,
  );
  const resolver = service as unknown as AuthorityResolver;
  const context = {
    practiceLocationId: 'location-1',
    lifecycleStatus: PracticeLocationLifecycleStatus.ACTIVE,
    doctorUserId: 'doctor-1',
  };

  it('lets the owning Doctor start without assigning a regular Secretary implicitly', async () => {
    await expect(
      resolver.assertActorAuthorityAndResolveOperatingStaff(
        {},
        context,
        null,
        {
          id: 'doctor-1',
          role: UserRole.DOCTOR,
          accountStatus: UserAccountStatus.ACTIVE,
          administrativeRestrictionStatus:
            AdministrativeRestrictionStatus.NONE,
        },
      ),
    ).resolves.toBeNull();
  });

  it('preserves an explicitly assigned Operating Secretary when the Doctor starts', async () => {
    await expect(
      resolver.assertActorAuthorityAndResolveOperatingStaff(
        {},
        context,
        {
          id: 'clinic-day-1',
          status: 'NOT_STARTED',
          operatingPracticeStaffId: 'staff-operating',
        },
        {
          id: 'doctor-1',
          role: UserRole.DOCTOR,
          accountStatus: UserAccountStatus.ACTIVE,
          administrativeRestrictionStatus:
            AdministrativeRestrictionStatus.NONE,
        },
      ),
    ).resolves.toBe('staff-operating');
  });

  it('does not grant a Secretary START CLINIC authority without an explicit ClinicDay operating assignment', async () => {
    await expect(
      resolver.assertActorAuthorityAndResolveOperatingStaff(
        {},
        context,
        null,
        {
          id: 'secretary-1',
          role: UserRole.SECRETARY,
          accountStatus: UserAccountStatus.ACTIVE,
          administrativeRestrictionStatus:
            AdministrativeRestrictionStatus.NONE,
        },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
