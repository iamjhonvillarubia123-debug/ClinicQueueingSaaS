import { randomUUID } from 'crypto';
import { ConflictException } from '@nestjs/common';
import {
  AdministrativeRestrictionStatus,
  PracticeLocationLifecycleStatus,
  SecretarySettingsDraftStatus,
  ServiceAvailabilityStatus,
  UserAccountStatus,
  UserRole,
  Weekday,
} from './../generated/prisma/client';
import { PrismaService } from './../src/prisma/prisma.service';
import { CrossLocationScheduleConflictService } from './../src/schedule/cross-location-schedule-conflict.service';
import { DoctorCalendarAvailabilityService } from './../src/schedule/doctor-calendar-availability.service';
import { RecurringScheduleConflictService } from './../src/schedule/recurring-schedule-conflict.service';
import { ScheduleResolutionService } from './../src/schedule/schedule-resolution.service';
import { ScheduleTimeService } from './../src/schedule/schedule-time.service';
import { SecretarySettingsDraftApprovalService } from './../src/secretary-settings-draft/secretary-settings-draft-approval.service';

describe('SecretarySettingsDraft approval rollback atomicity (e2e)', () => {
  let prisma: PrismaService;
  let approval: SecretarySettingsDraftApprovalService;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    const scheduleTime = new ScheduleTimeService();
    const scheduleResolution = new ScheduleResolutionService(
      prisma,
      scheduleTime,
    );
    const doctorCalendar = new DoctorCalendarAvailabilityService(
      prisma,
      scheduleTime,
    );
    const crossLocation = new CrossLocationScheduleConflictService(
      prisma,
      scheduleResolution,
      doctorCalendar,
    );
    const recurring = new RecurringScheduleConflictService(
      prisma,
      scheduleTime,
    );
    approval = new SecretarySettingsDraftApprovalService(
      prisma,
      scheduleResolution,
      doctorCalendar,
      crossLocation,
      recurring,
    );
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('rolls back effective settings, draft approval, and idempotency when final schedule validation conflicts', async () => {
    const scope = randomUUID().replaceAll('-', '');
    const email = `m3s12-rollback-${scope.slice(0, 12)}@example.test`;
    const doctorUser = await prisma.user.create({
      data: {
        email,
        firstName: 'Rollback',
        lastName: 'Doctor',
        mobileNumber: `0917${scope.slice(0, 7)}`,
        passwordHash: 'e2e-only-not-a-real-password-hash',
        role: UserRole.DOCTOR,
        accountStatus: UserAccountStatus.ACTIVE,
        administrativeRestrictionStatus: AdministrativeRestrictionStatus.NONE,
      },
    });
    const doctorProfile = await prisma.doctorProfile.create({
      data: {
        userId: doctorUser.id,
        professionalTitle: 'Dr.',
        specialization: 'Testing',
        licenseNumber: `RB-${scope.slice(0, 12)}`,
      },
    });
    const secretaryUser = await prisma.user.create({
      data: {
        email: `m3s12-secretary-${scope.slice(0, 10)}@example.test`,
        firstName: 'Rollback',
        lastName: 'Secretary',
        mobileNumber: `0918${scope.slice(0, 7)}`,
        passwordHash: 'e2e-only-not-a-real-password-hash',
        role: UserRole.SECRETARY,
        accountStatus: UserAccountStatus.ACTIVE,
        administrativeRestrictionStatus: AdministrativeRestrictionStatus.NONE,
      },
    });

    const locationA = await prisma.practiceLocation.create({
      data: {
        doctorProfileId: doctorProfile.id,
        lifecycleStatus: PracticeLocationLifecycleStatus.ACTIVE,
        name: `Rollback A ${scope.slice(0, 8)}`,
        countryCode: 'PH',
        timeZone: 'Asia/Manila',
      },
    });
    const locationB = await prisma.practiceLocation.create({
      data: {
        doctorProfileId: doctorProfile.id,
        lifecycleStatus: PracticeLocationLifecycleStatus.ACTIVE,
        name: `Rollback B ${scope.slice(0, 8)}`,
        countryCode: 'PH',
        timeZone: 'Asia/Manila',
      },
    });

    const practiceStaff = await prisma.practiceStaff.create({
      data: {
        userId: secretaryUser.id,
        practiceLocationId: locationA.id,
      },
    });
    await prisma.practiceLocation.update({
      where: { id: locationA.id },
      data: { currentRegularPracticeStaffId: practiceStaff.id },
    });

    const time = (hour: number) => new Date(Date.UTC(1970, 0, 1, hour));
    await prisma.practiceSchedule.createMany({
      data: [
        {
          practiceLocationId: locationA.id,
          weekday: Weekday.THURSDAY,
          isOpen: true,
          opensAtLocal: time(9),
          closesAtLocal: time(12),
        },
        {
          practiceLocationId: locationB.id,
          weekday: Weekday.THURSDAY,
          isOpen: true,
          opensAtLocal: time(13),
          closesAtLocal: time(17),
        },
      ],
    });

    const service = await prisma.practiceLocationService.create({
      data: {
        practiceLocationId: locationA.id,
        name: 'Original Service',
        durationMinutes: 30,
        status: ServiceAvailabilityStatus.ACTIVE,
      },
    });
    const draft = await prisma.secretarySettingsDraft.create({
      data: {
        practiceLocationId: locationA.id,
        authorPracticeStaffId: practiceStaff.id,
        status: SecretarySettingsDraftStatus.SUBMITTED,
        submittedAt: new Date(),
      },
    });
    await prisma.secretarySettingsDraftService.create({
      data: {
        secretarySettingsDraftId: draft.id,
        practiceLocationServiceId: service.id,
        proposedName: 'Changed Service',
        proposedDurationMinutes: 45,
        proposedStatus: ServiceAvailabilityStatus.ACTIVE,
      },
    });
    const conflictDate = new Date('2026-08-20T00:00:00.000Z');
    await prisma.secretarySettingsDraftScheduleException.create({
      data: {
        secretarySettingsDraftId: draft.id,
        serviceDate: conflictDate,
        proposedIsOpen: true,
        proposedOpensAtLocal: time(14),
        proposedClosesAtLocal: time(16),
      },
    });

    const idempotencyKey = `rollback-${scope.slice(0, 20)}`;
    try {
      await expect(
        approval.approve(doctorUser.id, draft.id, idempotencyKey),
      ).rejects.toBeInstanceOf(ConflictException);

      const preservedService =
        await prisma.practiceLocationService.findUniqueOrThrow({
          where: { id: service.id },
          select: { name: true, durationMinutes: true },
        });
      expect(preservedService).toEqual({
        name: 'Original Service',
        durationMinutes: 30,
      });

      const effectiveException = await prisma.scheduleException.findUnique({
        where: {
          practiceLocationId_serviceDate: {
            practiceLocationId: locationA.id,
            serviceDate: conflictDate,
          },
        },
      });
      expect(effectiveException).toBeNull();

      const preservedDraft =
        await prisma.secretarySettingsDraft.findUniqueOrThrow({
          where: { id: draft.id },
          select: { status: true, reviewedAt: true, reviewedByUserId: true },
        });
      expect(preservedDraft).toEqual({
        status: SecretarySettingsDraftStatus.SUBMITTED,
        reviewedAt: null,
        reviewedByUserId: null,
      });

      const idempotencyCount = await prisma.commandIdempotency.count({
        where: {
          actorUserId: doctorUser.id,
          practiceLocationId: locationA.id,
          idempotencyKey,
        },
      });
      expect(idempotencyCount).toBe(0);
    } finally {
      await prisma.secretarySettingsDraftScheduleException.deleteMany({
        where: { secretarySettingsDraftId: draft.id },
      });
      await prisma.secretarySettingsDraftService.deleteMany({
        where: { secretarySettingsDraftId: draft.id },
      });
      await prisma.secretarySettingsDraft.deleteMany({
        where: { id: draft.id },
      });
      await prisma.practiceLocationService.deleteMany({
        where: { id: service.id },
      });
      await prisma.practiceSchedule.deleteMany({
        where: { practiceLocationId: { in: [locationA.id, locationB.id] } },
      });
      await prisma.practiceLocation.update({
        where: { id: locationA.id },
        data: { currentRegularPracticeStaffId: null },
      });
      await prisma.practiceStaff.deleteMany({
        where: { id: practiceStaff.id },
      });
      await prisma.practiceLocation.deleteMany({
        where: { id: { in: [locationA.id, locationB.id] } },
      });
      await prisma.doctorProfile.deleteMany({
        where: { id: doctorProfile.id },
      });
      await prisma.user.deleteMany({
        where: { id: { in: [doctorUser.id, secretaryUser.id] } },
      });
    }
  });
});
