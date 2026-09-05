import { randomUUID } from 'crypto';
import {
  AdministrativeRestrictionStatus,
  BookingQuestionType,
  PracticeLocationLifecycleStatus,
  PracticeStaffRole,
  ServiceAvailabilityStatus,
  UserAccountStatus,
  UserRole,
  Weekday,
} from './../generated/prisma/client';
import { PrismaService } from './../src/prisma/prisma.service';
import { ScheduleTimeService } from './../src/schedule/schedule-time.service';
import { SecretarySettingsDraftBookingQuestionService } from './../src/secretary-settings-draft/secretary-settings-draft-booking-question.service';
import { SecretarySettingsDraftExceptionService } from './../src/secretary-settings-draft/secretary-settings-draft-exception.service';
import { SecretarySettingsDraftScheduleService } from './../src/secretary-settings-draft/secretary-settings-draft-schedule.service';
import { SecretarySettingsDraftServiceProposalService } from './../src/secretary-settings-draft/secretary-settings-draft-service.service';
import { SecretarySettingsDraftService } from './../src/secretary-settings-draft/secretary-settings-draft.service';

describe('R3 configuration drafting authority (e2e)', () => {
  let prisma: PrismaService;
  let draftService: SecretarySettingsDraftService;
  let serviceProposalService: SecretarySettingsDraftServiceProposalService;
  let scheduleService: SecretarySettingsDraftScheduleService;
  let exceptionService: SecretarySettingsDraftExceptionService;
  let bookingQuestionService: SecretarySettingsDraftBookingQuestionService;
  let doctorUserId: string;
  let secretaryUserId: string;
  let practiceLocationId: string;
  let practiceStaffId: string;
  let scope: string;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    draftService = new SecretarySettingsDraftService(prisma);
    serviceProposalService = new SecretarySettingsDraftServiceProposalService(prisma);
    scheduleService = new SecretarySettingsDraftScheduleService(prisma);
    exceptionService = new SecretarySettingsDraftExceptionService(
      prisma,
      new ScheduleTimeService(),
    );
    bookingQuestionService = new SecretarySettingsDraftBookingQuestionService(
      prisma,
    );

    scope = randomUUID().replaceAll('-', '');
    const doctor = await prisma.user.create({
      data: {
        email: `r3-config-doctor-${scope.slice(0, 12)}@example.test`,
        firstName: 'Config',
        lastName: 'Doctor',
        mobileNumber: `0960${scope.slice(0, 7)}`,
        passwordHash: 'e2e-only-not-a-real-password-hash',
        role: UserRole.DOCTOR,
        accountStatus: UserAccountStatus.ACTIVE,
        administrativeRestrictionStatus: AdministrativeRestrictionStatus.NONE,
        emailVerifiedAt: new Date(),
      },
    });
    doctorUserId = doctor.id;

    const profile = await prisma.doctorProfile.create({
      data: {
        userId: doctor.id,
        professionalTitle: 'Dr.',
        specialization: 'Configuration Testing',
        licenseNumber: `R3C-${scope.slice(0, 12)}`,
      },
    });
    const location = await prisma.practiceLocation.create({
      data: {
        doctorProfileId: profile.id,
        lifecycleStatus: PracticeLocationLifecycleStatus.ACTIVE,
        name: `R3 Config ${scope.slice(0, 8)}`,
        countryCode: 'PH',
        timeZone: 'Asia/Manila',
      },
    });
    practiceLocationId = location.id;

    const secretary = await prisma.user.create({
      data: {
        email: `r3-config-secretary-${scope.slice(0, 12)}@example.test`,
        firstName: 'Config',
        lastName: 'Secretary',
        mobileNumber: `0961${scope.slice(0, 7)}`,
        passwordHash: 'e2e-only-not-a-real-password-hash',
        role: UserRole.SECRETARY,
        accountStatus: UserAccountStatus.ACTIVE,
        administrativeRestrictionStatus: AdministrativeRestrictionStatus.NONE,
        emailVerifiedAt: new Date(),
      },
    });
    secretaryUserId = secretary.id;

    const staff = await prisma.practiceStaff.create({
      data: {
        userId: secretary.id,
        practiceLocationId,
        staffRole: PracticeStaffRole.SECRETARY,
        isActive: true,
      },
    });
    practiceStaffId = staff.id;
    await prisma.practiceLocation.update({
      where: { id: practiceLocationId },
      data: { currentRegularPracticeStaffId: staff.id },
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('denies draft creation without CLINIC_CONFIGURATION_DRAFTING authority', async () => {
    await expect(
      draftService.create(secretaryUserId, { practiceLocationId }),
    ).rejects.toThrow('Clinic Configuration Drafting authority');
  });

  it('allows creation with active authority and revocation blocks all further Secretary draft mutations', async () => {
    const now = new Date();
    const bundle = await prisma.practiceStaffAuthorityBundle.create({
      data: {
        practiceStaffId,
        bundleType: 'CLINIC_CONFIGURATION_DRAFTING',
        status: 'ACTIVE',
        grantedByUserId: doctorUserId,
        grantedAt: now,
        createdAt: now,
      },
    });

    const draft = await draftService.create(secretaryUserId, {
      practiceLocationId,
    });
    expect(draft.reused).toBe(false);

    const revokedAt = new Date();
    await prisma.practiceStaffAuthorityBundle.update({
      where: { id: bundle.id },
      data: {
        status: 'REVOKED',
        revokedByUserId: doctorUserId,
        revokedAt,
      },
    });

    const expected = 'Clinic Configuration Drafting authority';

    await expect(
      serviceProposalService.createProposal(secretaryUserId, draft.id, {
        name: 'Consultation',
        durationMinutes: 20,
        status: ServiceAvailabilityStatus.ACTIVE,
      }),
    ).rejects.toThrow(expected);

    await expect(
      scheduleService.upsertPracticeSchedule(secretaryUserId, draft.id, {
        weekday: Weekday.MONDAY,
        isOpen: true,
        opensAtLocal: '09:00',
        closesAtLocal: '12:00',
        maximumOnlineBookingUntilLocal: '11:00',
        maximumOperatingUntilLocal: '13:00',
      }),
    ).rejects.toThrow(expected);

    await expect(
      exceptionService.upsertScheduleException(secretaryUserId, draft.id, {
        serviceDate: '2026-12-21',
        isOpen: false,
      }),
    ).rejects.toThrow(expected);

    await expect(
      bookingQuestionService.createProposal(secretaryUserId, draft.id, {
        questionText: 'Reason for visit?',
        type: BookingQuestionType.TEXT,
        isRequired: false,
        displayOrder: 1,
        isActive: true,
        textMaximumLength: 200,
      }),
    ).rejects.toThrow(expected);

    await expect(draftService.submit(secretaryUserId, draft.id)).rejects.toThrow(
      expected,
    );

    const relationship = await prisma.practiceStaff.findUniqueOrThrow({
      where: { id: practiceStaffId },
    });
    expect(relationship.isActive).toBe(true);
  });
});
