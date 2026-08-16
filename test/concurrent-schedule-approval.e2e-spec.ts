import { randomUUID } from 'crypto';
import { ConflictException } from '@nestjs/common';
import {
  AdministrativeRestrictionStatus,
  PracticeLocationLifecycleStatus,
  SecretarySettingsDraftStatus,
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

describe('Concurrent schedule approval serialization (e2e)', () => {
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

  it('allows only one of two concurrently approved schedule changes when the combined result would conflict', async () => {
    const scope = randomUUID().replaceAll('-', '');
    const time = (hour: number) => new Date(Date.UTC(1970, 0, 1, hour));

    const doctorUser = await prisma.user.create({
      data: {
        email: `m4s3c-doctor-${scope.slice(0, 12)}@example.test`,
        firstName: 'Concurrent',
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
        specialization: 'Concurrency Testing',
        licenseNumber: `CC-${scope.slice(0, 12)}`,
      },
    });
    const secretaryUser = await prisma.user.create({
      data: {
        email: `m4s3c-secretary-${scope.slice(0, 10)}@example.test`,
        firstName: 'Concurrent',
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
        name: `Concurrent A ${scope.slice(0, 8)}`,
        countryCode: 'PH',
        timeZone: 'Asia/Manila',
      },
    });
    const locationB = await prisma.practiceLocation.create({
      data: {
        doctorProfileId: doctorProfile.id,
        lifecycleStatus: PracticeLocationLifecycleStatus.ACTIVE,
        name: `Concurrent B ${scope.slice(0, 8)}`,
        countryCode: 'PH',
        timeZone: 'Asia/Manila',
      },
    });

    const staffA = await prisma.practiceStaff.create({
      data: {
        userId: secretaryUser.id,
        practiceLocationId: locationA.id,
      },
    });
    const staffB = await prisma.practiceStaff.create({
      data: {
        userId: secretaryUser.id,
        practiceLocationId: locationB.id,
      },
    });
    await prisma.practiceLocation.update({
      where: { id: locationA.id },
      data: { currentRegularPracticeStaffId: staffA.id },
    });
    await prisma.practiceLocation.update({
      where: { id: locationB.id },
      data: { currentRegularPracticeStaffId: staffB.id },
    });

    await prisma.practiceSchedule.createMany({
      data: [
        {
          practiceLocationId: locationA.id,
          weekday: Weekday.MONDAY,
          isOpen: true,
          opensAtLocal: time(9),
          closesAtLocal: time(11),
        },
        {
          practiceLocationId: locationB.id,
          weekday: Weekday.MONDAY,
          isOpen: true,
          opensAtLocal: time(15),
          closesAtLocal: time(17),
        },
      ],
    });

    const draftA = await prisma.secretarySettingsDraft.create({
      data: {
        practiceLocationId: locationA.id,
        authorPracticeStaffId: staffA.id,
        status: SecretarySettingsDraftStatus.SUBMITTED,
        submittedAt: new Date(),
      },
    });
    const draftB = await prisma.secretarySettingsDraft.create({
      data: {
        practiceLocationId: locationB.id,
        authorPracticeStaffId: staffB.id,
        status: SecretarySettingsDraftStatus.SUBMITTED,
        submittedAt: new Date(),
      },
    });

    await prisma.secretarySettingsDraftPracticeSchedule.createMany({
      data: [
        {
          secretarySettingsDraftId: draftA.id,
          weekday: Weekday.MONDAY,
          proposedIsOpen: true,
          proposedOpensAtLocal: time(9),
          proposedClosesAtLocal: time(13),
        },
        {
          secretarySettingsDraftId: draftB.id,
          weekday: Weekday.MONDAY,
          proposedIsOpen: true,
          proposedOpensAtLocal: time(12),
          proposedClosesAtLocal: time(17),
        },
      ],
    });

    try {
      const results = await Promise.allSettled([
        approval.approve(
          doctorUser.id,
          draftA.id,
          `m4s3c-a-${scope.slice(0, 20)}`,
        ),
        approval.approve(
          doctorUser.id,
          draftB.id,
          `m4s3c-b-${scope.slice(0, 20)}`,
        ),
      ]);

      expect(
        results.filter((result) => result.status === 'fulfilled'),
      ).toHaveLength(1);
      expect(
        results.filter((result) => result.status === 'rejected'),
      ).toHaveLength(1);

      const rejectedResult = results.find(
        (result) => result.status === 'rejected',
      );
      if (!rejectedResult || rejectedResult.status !== 'rejected') {
        throw new Error('Expected one concurrent approval to be rejected.');
      }
      expect(rejectedResult.reason).toBeInstanceOf(ConflictException);

      const [effectiveA, effectiveB] = await Promise.all([
        prisma.practiceSchedule.findUniqueOrThrow({
          where: {
            practiceLocationId_weekday: {
              practiceLocationId: locationA.id,
              weekday: Weekday.MONDAY,
            },
          },
          select: { opensAtLocal: true, closesAtLocal: true },
        }),
        prisma.practiceSchedule.findUniqueOrThrow({
          where: {
            practiceLocationId_weekday: {
              practiceLocationId: locationB.id,
              weekday: Weekday.MONDAY,
            },
          },
          select: { opensAtLocal: true, closesAtLocal: true },
        }),
      ]);

      const aWon =
        effectiveA.opensAtLocal?.getUTCHours() === 9 &&
        effectiveA.closesAtLocal?.getUTCHours() === 13 &&
        effectiveB.opensAtLocal?.getUTCHours() === 15 &&
        effectiveB.closesAtLocal?.getUTCHours() === 17;
      const bWon =
        effectiveA.opensAtLocal?.getUTCHours() === 9 &&
        effectiveA.closesAtLocal?.getUTCHours() === 11 &&
        effectiveB.opensAtLocal?.getUTCHours() === 12 &&
        effectiveB.closesAtLocal?.getUTCHours() === 17;
      expect(aWon || bWon).toBe(true);

      expect(
        effectiveA.closesAtLocal!.getTime() <=
          effectiveB.opensAtLocal!.getTime() ||
          effectiveB.closesAtLocal!.getTime() <=
            effectiveA.opensAtLocal!.getTime(),
      ).toBe(true);

      const drafts = await prisma.secretarySettingsDraft.findMany({
        where: { id: { in: [draftA.id, draftB.id] } },
        select: { id: true, status: true },
      });
      expect(
        drafts.filter(
          (draft) => draft.status === SecretarySettingsDraftStatus.APPROVED,
        ),
      ).toHaveLength(1);
      expect(
        drafts.filter(
          (draft) => draft.status === SecretarySettingsDraftStatus.SUBMITTED,
        ),
      ).toHaveLength(1);

      const commandCount = await prisma.commandIdempotency.count({
        where: {
          actorUserId: doctorUser.id,
          practiceLocationId: { in: [locationA.id, locationB.id] },
        },
      });
      expect(commandCount).toBe(1);
    } finally {
      await prisma.commandIdempotency.deleteMany({
        where: {
          actorUserId: doctorUser.id,
          practiceLocationId: { in: [locationA.id, locationB.id] },
        },
      });
      await prisma.secretarySettingsDraftPracticeSchedule.deleteMany({
        where: { secretarySettingsDraftId: { in: [draftA.id, draftB.id] } },
      });
      await prisma.secretarySettingsDraft.deleteMany({
        where: { id: { in: [draftA.id, draftB.id] } },
      });
      await prisma.practiceSchedule.deleteMany({
        where: { practiceLocationId: { in: [locationA.id, locationB.id] } },
      });
      await prisma.practiceLocation.update({
        where: { id: locationA.id },
        data: { currentRegularPracticeStaffId: null },
      });
      await prisma.practiceLocation.update({
        where: { id: locationB.id },
        data: { currentRegularPracticeStaffId: null },
      });
      await prisma.practiceStaff.deleteMany({
        where: { id: { in: [staffA.id, staffB.id] } },
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
