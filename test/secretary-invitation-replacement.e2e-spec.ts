import { PracticeLocationStaffReadService } from '../src/practice-location/practice-location-staff-read.service';
import { SecretaryWorkspaceService } from '../src/practice-staff/secretary-workspace.service';
import { ConfigService } from '@nestjs/config';
import { randomUUID, randomBytes } from 'crypto';
import { PrismaService } from '../src/prisma/prisma.service';
import { SecretaryInvitationService } from '../src/practice-staff/secretary-invitation.service';
import { ProtectedAccountPayloadService } from '../src/auth/security/protected-account-payload.service';
import { PasswordSecurityService } from '../src/auth/security/password-security.service';
import { NotificationPayloadService } from '../src/notification/notification-payload.service';
import { MobileNumberService } from '../src/security/mobile-number/mobile-number.service';
import { MobileNumberNormalizer } from '../src/security/mobile-number/mobile-number-normalizer';
import { SecretaryInvitationAssignmentType } from '../src/practice-staff/dto/create-secretary-invitation.dto';
import { ClinicSecretaryAuthorityBundle } from '../src/practice-staff/secretary-authority.types';
import { SubstituteSecretaryCoverageMode } from '../src/practice-staff/substitute-secretary-coverage.types';

describe('Secretary invitation conflicts and replacement (isolated database)', () => {
  const prisma = new PrismaService();
  const passwords = new PasswordSecurityService();
  const config = new ConfigService({
    MOBILE_ENCRYPTION_KEY_V1: Buffer.alloc(32, 21).toString('base64'),
    MOBILE_LOOKUP_HMAC_KEY_V1: Buffer.alloc(32, 22).toString('base64'),
    MOBILE_ENCRYPTION_ACTIVE_KEY_ID: 'invitation-test-encryption',
    MOBILE_LOOKUP_ACTIVE_KEY_ID: 'invitation-test-lookup',
    PUBLIC_APP_BASE_URL: 'https://example.test',
  });
  const mobile = new MobileNumberService(new MobileNumberNormalizer(), config);
  const service = new SecretaryInvitationService(
    prisma,
    config,
    new ProtectedAccountPayloadService(config),
    new NotificationPayloadService(config),
    passwords,
    mobile,
  );
  const password = 'Invitation test password 42!';
  beforeAll(async () => prisma.$connect());
  afterAll(async () => prisma.$disconnect());

  async function fixture() {
    const doctor = await prisma.user.create({
      data: {
        email: `${randomUUID()}@example.test`,
        firstName: 'Test',
        lastName: 'Doctor',
        passwordHash: await passwords.hashStrong(password),
        role: 'DOCTOR',
        emailVerifiedAt: new Date(),
      },
    });
    const profile = await prisma.doctorProfile.create({
      data: {
        userId: doctor.id,
        professionalTitle: 'Dr.',
        specialization: 'Test',
        licenseNumber: randomUUID(),
      },
    });
    const clinic = await prisma.practiceLocation.create({
      data: {
        doctorProfileId: profile.id,
        name: 'Invitation test clinic',
        countryCode: 'PH',
        timeZone: 'Asia/Manila',
      },
    });
    const secretaries = await Promise.all(
      [1, 2, 3].map(async () =>
        prisma.user.create({
          data: {
            email: `${randomUUID()}@example.test`,
            firstName: 'Test',
            lastName: 'Secretary',
            passwordHash: 'fixture-only',
            role: 'SECRETARY',
            emailVerifiedAt: new Date(),
          },
        }),
      ),
    );
    return { doctor, clinic, secretaries };
  }
  const clinicPlan = {
    assignmentType: SecretaryInvitationAssignmentType.CLINIC_SECRETARY,
    authorityBundles: [
      ClinicSecretaryAuthorityBundle.QUEUE_AND_CLINIC_DAY_OPERATIONS,
    ],
  };
  const coveragePlan = (fromServiceDate: string, toServiceDate: string) => ({
    assignmentType: SecretaryInvitationAssignmentType.SUBSTITUTE_SECRETARY,
    coverageMode: SubstituteSecretaryCoverageMode.DATE_RANGE,
    fromServiceDate,
    toServiceDate,
  });

  it('serializes competing clinic invitations, then permits an authorized replacement after acceptance', async () => {
    const { doctor, clinic, secretaries } = await fixture();
    const attempts = await Promise.allSettled(
      secretaries.slice(0, 2).map((user) =>
        service.create(doctor.id, {
          ...clinicPlan,
          practiceLocationId: clinic.id,
          identifier: user.email!,
        }),
      ),
    );
    expect(
      attempts.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    const pending = await prisma.secretaryInvitation.findFirstOrThrow({
      where: { practiceLocationId: clinic.id, status: 'PENDING' },
    });
    await service.acceptPendingById(pending.targetUserId!, pending.id);
    const outgoing = await prisma.practiceStaff.findFirstOrThrow({
      where: { practiceLocationId: clinic.id, userId: pending.targetUserId! },
    });
    const replacement = await service.create(doctor.id, {
      ...clinicPlan,
      practiceLocationId: clinic.id,
      identifier: secretaries[2].email!,
      password,
    });
    expect(
      (
        await prisma.practiceStaff.findUniqueOrThrow({
          where: { id: outgoing.id },
        })
      ).isActive,
    ).toBe(true);
    await service.acceptPendingById(
      secretaries[2].id,
      replacement.invitationId,
    );
    expect(
      (
        await prisma.practiceStaff.findUniqueOrThrow({
          where: { id: outgoing.id },
        })
      ).isActive,
    ).toBe(false);
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: outgoing.userId } }))
        .accountStatus,
    ).toBe('ACTIVE');
  });

  it('can cancel a legacy competing invitation after failed acceptance without removing the account', async () => {
    const { doctor, clinic, secretaries } = await fixture();
    const first = await service.create(doctor.id, {
      ...clinicPlan,
      practiceLocationId: clinic.id,
      identifier: secretaries[0].email!,
    });
    const original = await prisma.secretaryInvitation.findUniqueOrThrow({
      where: { id: first.invitationId },
    });
    const legacy = await prisma.secretaryInvitation.create({
      data: {
        ...original,
        coverageRevisions: [],
        requestedCoverageRanges: [],
        id: randomUUID(),
        targetUserId: secretaries[1].id,
        normalizedIdentifier: secretaries[1].email!,
        normalizedEmail: secretaries[1].email,
        activeInvitationKey: randomBytes(32).toString('hex'),
        tokenHash: randomBytes(32).toString('hex'),
      },
    });
    await service.acceptPendingById(secretaries[0].id, first.invitationId);
    await expect(
      service.acceptPendingById(secretaries[1].id, legacy.id),
    ).rejects.toThrow('clinic has assigned a different Clinic Secretary');
    await service.revokePending(doctor.id, legacy.id);
    expect(
      (
        await prisma.secretaryInvitation.findUniqueOrThrow({
          where: { id: legacy.id },
        })
      ).status,
    ).toBe('REVOKED');
    expect(
      (
        await prisma.user.findUniqueOrThrow({
          where: { id: secretaries[1].id },
        })
      ).accountStatus,
    ).toBe('ACTIVE');
    expect(
      await prisma.practiceStaff.count({
        where: { userId: secretaries[1].id },
      }),
    ).toBe(0);
  });

  it('blocks pending date overlaps and replaces only accepted dates, retaining both outside periods and history', async () => {
    const { doctor, clinic, secretaries } = await fixture();
    const invite = (index: number, from: string, to: string) =>
      service.create(doctor.id, {
        ...coveragePlan(from, to),
        practiceLocationId: clinic.id,
        identifier: secretaries[index].email!,
      });
    const first = await invite(0, '2027-01-01', '2027-01-10');
    await service.acceptPendingById(secretaries[0].id, first.invitationId);
    const original = await prisma.substituteSecretaryCoverage.findFirstOrThrow({
      where: { practiceLocationId: clinic.id, status: 'ACTIVE' },
    });
    const days = await Promise.all(
      ['2027-01-02', '2027-01-05'].map((date) =>
        prisma.clinicDay.create({
          data: {
            practiceLocationId: clinic.id,
            serviceDate: new Date(date),
            status: 'STARTED',
            startedAt: new Date(date),
            operatingPracticeStaffId: original.practiceStaffId,
          },
        }),
      ),
    );
    const second = await invite(1, '2027-01-04', '2027-01-06');
    await expect(invite(2, '2027-01-06', '2027-01-08')).rejects.toThrow(
      'already pending',
    );
    const third = await invite(2, '2027-01-11', '2027-01-12');
    await expect(
      service.updatePending(
        doctor.id,
        third.invitationId,
        coveragePlan('2027-01-03', '2027-01-04'),
      ),
    ).rejects.toThrow('already pending');
    expect(
      await prisma.substituteSecretaryCoverageDate.count({
        where: { coverageId: original.id, status: 'ACTIVE' },
      }),
    ).toBe(10);
    await service.acceptPendingById(secretaries[1].id, second.invitationId);
    expect(
      (await prisma.clinicDay.findUniqueOrThrow({ where: { id: days[0].id } }))
        .operatingPracticeStaffId,
    ).toBe(original.practiceStaffId);
    expect(
      await prisma.clinicDay.findUniqueOrThrow({ where: { id: days[1].id } }),
    ).toMatchObject({ status: 'STARTED', operatingPracticeStaffId: null });
    expect(
      await prisma.clinicDayOperatingStaffAudit.count({
        where: {
          clinicDayId: days[1].id,
          changeType: 'CLEARED',
          actorUserId: doctor.id,
        },
      }),
    ).toBe(1);
    const remaining = await prisma.substituteSecretaryCoverage.findMany({
      where: { practiceStaffId: original.practiceStaffId, status: 'ACTIVE' },
      orderBy: { fromServiceDate: 'asc' },
    });
    expect(
      remaining.map((row) => [
        row.fromServiceDate.toISOString().slice(0, 10),
        row.toServiceDate.toISOString().slice(0, 10),
      ]),
    ).toEqual([
      ['2027-01-01', '2027-01-03'],
      ['2027-01-07', '2027-01-10'],
    ]);
    expect(
      remaining.every((row) => row.supersedesCoverageId === original.id),
    ).toBe(true);
    expect(
      (
        await prisma.substituteSecretaryCoverage.findUniqueOrThrow({
          where: { id: original.id },
        })
      ).status,
    ).toBe('SUPERSEDED');
    expect(
      await prisma.substituteSecretaryCoverageDate.count({
        where: { practiceLocationId: clinic.id, status: 'ACTIVE' },
      }),
    ).toBe(10);
    expect(
      await prisma.substituteSecretaryCoverageDate.count({
        where: { coverageId: original.id, status: 'SUPERSEDED' },
      }),
    ).toBe(10);
  });

  it('replaces only the reviewed pending invitation atomically and invalidates its acceptance', async () => {
    const { doctor, clinic, secretaries } = await fixture();
    const first = await service.create(doctor.id, {
      ...clinicPlan,
      practiceLocationId: clinic.id,
      identifier: secretaries[0].email!,
    });
    const replacement = await service.create(doctor.id, {
      ...clinicPlan,
      practiceLocationId: clinic.id,
      identifier: secretaries[1].email!,
      replacePendingInvitationIds: [first.invitationId],
    });
    expect(
      await prisma.secretaryInvitation.count({
        where: { practiceLocationId: clinic.id, status: 'PENDING' },
      }),
    ).toBe(1);
    expect(
      await prisma.secretaryInvitation.findUniqueOrThrow({
        where: { id: first.invitationId },
      }),
    ).toMatchObject({ status: 'REVOKED', activeInvitationKey: null });
    expect(
      (
        await prisma.notificationOutbox.findFirstOrThrow({
          where: { secretaryInvitationId: first.invitationId },
        })
      ).status,
    ).toBe('CANCELLED');
    await expect(
      service.acceptPendingById(secretaries[0].id, first.invitationId),
    ).rejects.toThrow();
    await service.acceptPendingById(
      secretaries[1].id,
      replacement.invitationId,
    );
    expect(
      (
        await prisma.user.findUniqueOrThrow({
          where: { id: secretaries[0].id },
        })
      ).accountStatus,
    ).toBe('ACTIVE');
  });

  it('does not cancel an invitation that has already been accepted or belongs to another clinic', async () => {
    const { doctor, clinic, secretaries } = await fixture();
    const first = await service.create(doctor.id, {
      ...clinicPlan,
      practiceLocationId: clinic.id,
      identifier: secretaries[0].email!,
    });
    const other = await fixture();
    await expect(
      service.create(other.doctor.id, {
        ...clinicPlan,
        practiceLocationId: other.clinic.id,
        identifier: other.secretaries[0].email!,
        replacePendingInvitationIds: [first.invitationId],
      }),
    ).rejects.toThrow('pending invitation changed');
    expect(
      (
        await prisma.secretaryInvitation.findUniqueOrThrow({
          where: { id: first.invitationId },
        })
      ).status,
    ).toBe('PENDING');
    await service.acceptPendingById(secretaries[0].id, first.invitationId);
    await expect(
      service.create(doctor.id, {
        ...clinicPlan,
        practiceLocationId: clinic.id,
        identifier: secretaries[1].email!,
        password,
        replacePendingInvitationIds: [first.invitationId],
      }),
    ).rejects.toThrow('pending invitation changed');
    expect(
      await prisma.secretaryInvitation.count({
        where: { practiceLocationId: clinic.id, status: 'PENDING' },
      }),
    ).toBe(0);
    expect(
      (
        await prisma.secretaryInvitation.findUniqueOrThrow({
          where: { id: first.invitationId },
        })
      ).status,
    ).toBe('ACCEPTED');
  });

  it('keeps a partially overridden pending invitation and accepts only its two remaining periods', async () => {
    const { doctor, clinic, secretaries } = await fixture();
    const first = await service.create(doctor.id, {
      ...coveragePlan('2027-02-01', '2027-02-10'),
      practiceLocationId: clinic.id,
      identifier: secretaries[0].email!,
    });
    const before = await prisma.secretaryInvitation.findUniqueOrThrow({
      where: { id: first.invitationId },
    });
    const replacement = await service.create(doctor.id, {
      ...coveragePlan('2027-02-04', '2027-02-06'),
      practiceLocationId: clinic.id,
      identifier: secretaries[1].email!,
      replacePendingInvitationIds: [first.invitationId],
    });
    const revised = await prisma.secretaryInvitation.findUniqueOrThrow({
      where: { id: first.invitationId },
    });
    expect(revised.status).toBe('PENDING');
    expect(revised.tokenHash).toBe(before.tokenHash);
    expect(revised.activeInvitationKey).toBe(before.activeInvitationKey);
    expect(revised.requestedFromServiceDate).toEqual(
      before.requestedFromServiceDate,
    );
    expect(revised.coverageRevisions).toEqual([
      expect.objectContaining({
        fromServiceDate: '2027-02-04',
        toServiceDate: '2027-02-06',
        actorUserId: doctor.id,
        replacementInvitationId: replacement.invitationId,
      }),
    ]);
    await service.updatePending(
      doctor.id,
      first.invitationId,
      coveragePlan('2027-02-01', '2027-02-10'),
    );
    const expectedRanges = [
      { fromServiceDate: '2027-02-01', toServiceDate: '2027-02-03' },
      { fromServiceDate: '2027-02-07', toServiceDate: '2027-02-10' },
    ];
    const doctorView = await new PracticeLocationStaffReadService(
      prisma,
    ).getClinicStaff(doctor.id, clinic.id);
    expect(
      doctorView.pendingInvitations.find(
        (invitation) => invitation.invitationId === first.invitationId,
      )?.coverageRanges,
    ).toEqual(expectedRanges);
    const secretaryView = await new SecretaryWorkspaceService(
      prisma,
    ).getWorkspace(secretaries[0].id);
    expect(
      secretaryView.invitations.find(
        (invitation) => invitation.invitationId === first.invitationId,
      )?.coverageRanges,
    ).toEqual(expectedRanges);

    await service.acceptPendingById(
      secretaries[1].id,
      replacement.invitationId,
    );
    await service.acceptPendingById(secretaries[0].id, first.invitationId);
    const dates = await prisma.substituteSecretaryCoverageDate.findMany({
      where: {
        practiceLocationId: clinic.id,
        status: 'ACTIVE',
        coverage: { practiceStaff: { userId: secretaries[0].id } },
      },
      orderBy: { serviceDate: 'asc' },
    });
    expect(
      dates.map((day) => day.serviceDate.toISOString().slice(8, 10)),
    ).toEqual(['01', '02', '03', '07', '08', '09', '10']);
    expect(
      await prisma.substituteSecretaryCoverageDate.count({
        where: { practiceLocationId: clinic.id, status: 'ACTIVE' },
      }),
    ).toBe(10);
  });

  it('cancels a fully overridden pending substitute invitation and retains its revision history', async () => {
    const { doctor, clinic, secretaries } = await fixture();
    const first = await service.create(doctor.id, {
      ...coveragePlan('2027-03-04', '2027-03-06'),
      practiceLocationId: clinic.id,
      identifier: secretaries[0].email!,
    });
    await service.create(doctor.id, {
      ...coveragePlan('2027-03-01', '2027-03-10'),
      practiceLocationId: clinic.id,
      identifier: secretaries[1].email!,
      replacePendingInvitationIds: [first.invitationId],
    });
    const original = await prisma.secretaryInvitation.findUniqueOrThrow({
      where: { id: first.invitationId },
    });
    expect(original).toMatchObject({
      status: 'REVOKED',
      activeInvitationKey: null,
    });
    expect(original.coverageRevisions).toHaveLength(1);
    await expect(
      service.acceptPendingById(secretaries[0].id, first.invitationId),
    ).rejects.toThrow('cancelled');
    expect(
      (
        await prisma.notificationOutbox.findFirstOrThrow({
          where: { secretaryInvitationId: first.invitationId },
        })
      ).status,
    ).toBe('CANCELLED');
  });

  it('disables outgoing clinic access only on acceptance when all active substitute dates are replaced', async () => {
    const { doctor, clinic, secretaries } = await fixture();
    const first = await service.create(doctor.id, {
      ...coveragePlan('2027-04-01', '2027-04-03'),
      practiceLocationId: clinic.id,
      identifier: secretaries[0].email!,
    });
    await service.acceptPendingById(secretaries[0].id, first.invitationId);
    const old = await prisma.practiceStaff.findFirstOrThrow({
      where: { practiceLocationId: clinic.id, userId: secretaries[0].id },
    });
    const replacement = await service.create(doctor.id, {
      ...coveragePlan('2027-04-01', '2027-04-03'),
      practiceLocationId: clinic.id,
      identifier: secretaries[1].email!,
    });
    expect(
      (await prisma.practiceStaff.findUniqueOrThrow({ where: { id: old.id } }))
        .isActive,
    ).toBe(true);
    await service.acceptPendingById(
      secretaries[1].id,
      replacement.invitationId,
    );
    expect(
      (await prisma.practiceStaff.findUniqueOrThrow({ where: { id: old.id } }))
        .isActive,
    ).toBe(false);
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: old.userId } }))
        .accountStatus,
    ).toBe('ACTIVE');
  });

  it('rolls back pending revisions when another overlapping invitation was not reviewed', async () => {
    const { doctor, clinic, secretaries } = await fixture();
    const first = await service.create(doctor.id, {
      ...coveragePlan('2027-05-01', '2027-05-04'),
      practiceLocationId: clinic.id,
      identifier: secretaries[0].email!,
    });
    await service.create(doctor.id, {
      ...coveragePlan('2027-05-05', '2027-05-08'),
      practiceLocationId: clinic.id,
      identifier: secretaries[1].email!,
    });
    await expect(
      service.create(doctor.id, {
        ...coveragePlan('2027-05-03', '2027-05-06'),
        practiceLocationId: clinic.id,
        identifier: secretaries[2].email!,
        replacePendingInvitationIds: [first.invitationId],
      }),
    ).rejects.toThrow('already pending');
    expect(
      (
        await prisma.secretaryInvitation.findUniqueOrThrow({
          where: { id: first.invitationId },
        })
      ).coverageRevisions,
    ).toEqual([]);
    expect(
      await prisma.secretaryInvitation.count({
        where: { practiceLocationId: clinic.id, status: 'PENDING' },
      }),
    ).toBe(2);
  });

  it('reuses a disabled connected Clinic Secretary as a substitute only after invitation acceptance', async () => {
    const { doctor, clinic, secretaries } = await fixture();
    const first = await service.create(doctor.id, {
      ...clinicPlan,
      practiceLocationId: clinic.id,
      identifier: secretaries[0].email!,
    });
    await service.acceptPendingById(secretaries[0].id, first.invitationId);
    const replacement = await service.create(doctor.id, {
      ...clinicPlan,
      practiceLocationId: clinic.id,
      identifier: secretaries[1].email!,
      password,
    });
    await service.acceptPendingById(
      secretaries[1].id,
      replacement.invitationId,
    );
    const read = new PracticeLocationStaffReadService(prisma);
    const before = await read.getClinicStaff(doctor.id, clinic.id);
    const candidate = before.candidates.find(
      (entry) => entry.userId === secretaries[0].id,
    );
    expect(candidate?.identifier).toBe(secretaries[0].email);
    expect(
      before.staffAssignments.find(
        (entry) => entry.userId === secretaries[0].id,
      )?.assignmentActive,
    ).toBe(false);
    const invite = await service.create(doctor.id, {
      ...coveragePlan('2027-08-01', '2027-08-03'),
      practiceLocationId: clinic.id,
      identifier: candidate!.identifier!,
    });
    expect(
      (await read.getClinicStaff(doctor.id, clinic.id)).staffAssignments.find(
        (entry) => entry.userId === secretaries[0].id,
      )?.assignmentActive,
    ).toBe(false);
    await service.acceptPendingById(secretaries[0].id, invite.invitationId);
    const after = await read.getClinicStaff(doctor.id, clinic.id);
    expect(
      after.staffAssignments.find(
        (entry) => entry.userId === secretaries[0].id,
      ),
    ).toMatchObject({
      assignmentActive: true,
      assignmentType: 'SUBSTITUTE_SECRETARY',
      isClinicSecretary: false,
    });
    expect(
      after.staffAssignments.find(
        (entry) => entry.userId === secretaries[1].id,
      ),
    ).toMatchObject({ assignmentActive: true, isClinicSecretary: true });
  });

  it('accepts a mixed schedule and replaces only its selected days, leaving gaps available', async () => {
    const { doctor, clinic, secretaries } = await fixture();
    const old = await service.create(doctor.id, {
      ...coveragePlan('2027-01-04', '2027-01-24'),
      practiceLocationId: clinic.id,
      identifier: secretaries[0].email!,
    });
    await service.acceptPendingById(secretaries[0].id, old.invitationId);
    const selected = [
      { fromServiceDate: '2027-01-04', toServiceDate: '2027-01-10' },
      ...[
        '2027-01-11',
        '2027-01-13',
        '2027-01-15',
        '2027-01-19',
        '2027-01-21',
        '2027-02-01',
      ].map((day) => ({ fromServiceDate: day, toServiceDate: day })),
    ];
    const invite = await service.create(doctor.id, {
      ...coveragePlan('2027-01-04', '2027-02-01'),
      coverageRanges: selected,
      practiceLocationId: clinic.id,
      identifier: secretaries[1].email!,
    });
    const gap = await service.create(doctor.id, {
      ...coveragePlan('2027-01-12', '2027-01-12'),
      practiceLocationId: clinic.id,
      identifier: secretaries[2].email!,
    });
    await service.acceptPendingById(secretaries[1].id, invite.invitationId);
    const covered = await prisma.substituteSecretaryCoverageDate.findMany({
      where: {
        practiceLocationId: clinic.id,
        status: 'ACTIVE',
        coverage: { practiceStaff: { userId: secretaries[1].id } },
      },
      orderBy: { serviceDate: 'asc' },
    });
    expect(covered).toHaveLength(13);
    expect(
      covered.some(
        (day) => day.serviceDate.toISOString().slice(0, 10) === '2027-01-12',
      ),
    ).toBe(false);
    expect(
      await prisma.substituteSecretaryCoverageDate.count({
        where: {
          practiceLocationId: clinic.id,
          status: 'ACTIVE',
          serviceDate: new Date('2027-01-12'),
          coverage: { practiceStaff: { userId: secretaries[0].id } },
        },
      }),
    ).toBe(1);
    await service.acceptPendingById(secretaries[2].id, gap.invitationId);
    expect(
      (
        await prisma.practiceStaff.findFirstOrThrow({
          where: { practiceLocationId: clinic.id, userId: secretaries[0].id },
        })
      ).isActive,
    ).toBe(true);
  });

  it('revises pending coverage only on the separated days in a new schedule', async () => {
    const { doctor, clinic, secretaries } = await fixture();
    const old = await service.create(doctor.id, {
      ...coveragePlan('2027-06-01', '2027-06-10'),
      practiceLocationId: clinic.id,
      identifier: secretaries[0].email!,
    });
    await service.create(doctor.id, {
      ...coveragePlan('2027-06-02', '2027-06-08'),
      coverageRanges: ['2027-06-02', '2027-06-08'].map((day) => ({
        fromServiceDate: day,
        toServiceDate: day,
      })),
      practiceLocationId: clinic.id,
      identifier: secretaries[1].email!,
      replacePendingInvitationIds: [old.invitationId],
    });
    const view = await new PracticeLocationStaffReadService(
      prisma,
    ).getClinicStaff(doctor.id, clinic.id);
    expect(
      view.pendingInvitations.find(
        (invitation) => invitation.invitationId === old.invitationId,
      )?.coverageRanges,
    ).toEqual([
      { fromServiceDate: '2027-06-01', toServiceDate: '2027-06-01' },
      { fromServiceDate: '2027-06-03', toServiceDate: '2027-06-07' },
      { fromServiceDate: '2027-06-09', toServiceDate: '2027-06-10' },
    ]);
  });
  async function openMonday(clinicId: string) {
    await prisma.practiceSchedule.create({
      data: {
        practiceLocationId: clinicId,
        weekday: 'MONDAY',
        isOpen: true,
        opensAtLocal: new Date('1970-01-01T09:00:00Z'),
        closesAtLocal: new Date('1970-01-01T12:00:00Z'),
      },
    });
  }
  it('serializes cross-doctor acceptance and allows leaving with password before accepting the conflict', async () => {
    const a = await fixture();
    const b = await fixture();
    const secretary = a.secretaries[0];
    await prisma.user.update({
      where: { id: secretary.id },
      data: { passwordHash: await passwords.hashStrong(password) },
    });
    await openMonday(a.clinic.id);
    await openMonday(b.clinic.id);
    const invitations = await Promise.all(
      [a, b].map((f) =>
        service.create(f.doctor.id, {
          ...clinicPlan,
          practiceLocationId: f.clinic.id,
          identifier: secretary.email!,
        }),
      ),
    );
    const results = await Promise.allSettled(
      invitations.map((i) =>
        service.acceptPendingById(secretary.id, i.invitationId),
      ),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find(
      (r) => r.status === 'rejected',
    ) as PromiseRejectedResult;
    expect(String(rejected.reason)).toContain('Disconnect from that clinic');
    const connection = await prisma.practiceStaff.findFirstOrThrow({
      where: { userId: secretary.id, isActive: true },
    });
    const pending = await prisma.secretaryInvitation.findFirstOrThrow({
      where: { targetUserId: secretary.id, status: 'PENDING' },
    });
    await expect(
      service.disconnectSelf(secretary.id, connection.id, 'wrong'),
    ).rejects.toThrow('password');
    expect(
      (
        await prisma.practiceStaff.findUniqueOrThrow({
          where: { id: connection.id },
        })
      ).isActive,
    ).toBe(true);
    await expect(
      service.disconnectSelf(a.secretaries[1].id, connection.id, password),
    ).rejects.toThrow();
    await service.disconnectSelf(secretary.id, connection.id, password);
    await service.disconnectSelf(secretary.id, connection.id, password);
    expect(
      (
        await prisma.practiceStaff.findUniqueOrThrow({
          where: { id: connection.id },
        })
      ).disconnectedAt,
    ).not.toBeNull();
    expect(
      (
        await prisma.practiceLocation.findUniqueOrThrow({
          where: { id: connection.practiceLocationId },
        })
      ).currentRegularPracticeStaffId,
    ).toBeNull();
    expect(
      await prisma.practiceStaffAuthorityBundle.count({
        where: { practiceStaffId: connection.id, status: 'ACTIVE' },
      }),
    ).toBe(0);
    expect(
      await prisma.applicationNotification.count({
        where: {
          affectedSecretaryUserId: secretary.id,
          title: 'Secretary disconnected from clinic',
        },
      }),
    ).toBe(1);
    const owner =
      connection.practiceLocationId === a.clinic.id ? a.doctor.id : b.doctor.id;
    const history = await new PracticeLocationStaffReadService(
      prisma,
    ).getClinicStaff(owner, connection.practiceLocationId);
    expect(
      history.staffAssignments.find(
        (item) => item.practiceStaffId === connection.id,
      ),
    ).toMatchObject({
      disconnectedAt: expect.any(Date) as unknown,
      assignmentActive: false,
      operationallyReady: false,
    });
    await service.acceptPendingById(secretary.id, pending.id);
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: secretary.id } }))
        .accountStatus,
    ).toBe('ACTIVE');
  });
  it('declines only the addressed invitation and notifies its doctor without deleting history', async () => {
    const f = await fixture();
    const invite = await service.create(f.doctor.id, {
      ...clinicPlan,
      practiceLocationId: f.clinic.id,
      identifier: f.secretaries[0].email!,
    });
    await expect(
      service.declinePendingById(f.secretaries[1].id, invite.invitationId),
    ).rejects.toThrow('different Secretary');
    await service.declinePendingById(f.secretaries[0].id, invite.invitationId);
    const row = await prisma.secretaryInvitation.findUniqueOrThrow({
      where: { id: invite.invitationId },
    });
    expect(row.status).toBe('DECLINED');
    const history = await new PracticeLocationStaffReadService(
      prisma,
    ).getClinicStaff(f.doctor.id, f.clinic.id);
    expect(history.pendingInvitations).toHaveLength(0);
    expect(
      history.declinedInvitations.map((item) => item.invitationId),
    ).toContain(invite.invitationId);
    expect(row.tokenHash).toBeNull();
    expect(row.activeInvitationKey).toBeNull();
    await expect(
      service.acceptPendingById(f.secretaries[0].id, invite.invitationId),
    ).rejects.toThrow();
    expect(
      await prisma.applicationNotification.count({
        where: {
          recipientUserId: f.doctor.id,
          affectedSecretaryUserId: f.secretaries[0].id,
          title: 'Secretary invitation declined',
        },
      }),
    ).toBe(1);
    expect(
      await prisma.practiceStaff.count({
        where: { userId: f.secretaries[0].id },
      }),
    ).toBe(0);
  });
  it('checks exact substitute dates, allowing gaps but rejecting an overlapping covered Monday', async () => {
    const a = await fixture();
    const b = await fixture();
    const secretary = a.secretaries[0];
    await openMonday(a.clinic.id);
    await openMonday(b.clinic.id);
    const first = await service.create(a.doctor.id, {
      ...coveragePlan('2027-01-04', '2027-01-04'),
      practiceLocationId: a.clinic.id,
      identifier: secretary.email!,
    });
    await service.acceptPendingById(secretary.id, first.invitationId);
    const second = await service.create(b.doctor.id, {
      ...coveragePlan('2027-01-04', '2027-01-04'),
      practiceLocationId: b.clinic.id,
      identifier: secretary.email!,
    });
    await expect(
      service.acceptPendingById(secretary.id, second.invitationId),
    ).rejects.toThrow('conflicts');
    await service.declinePendingById(secretary.id, second.invitationId);
    const separate = await service.create(b.doctor.id, {
      ...coveragePlan('2027-01-11', '2027-01-11'),
      practiceLocationId: b.clinic.id,
      identifier: secretary.email!,
    });
    await service.acceptPendingById(secretary.id, separate.invitationId);
    expect(
      await prisma.practiceStaff.count({
        where: { userId: secretary.id, isActive: true },
      }),
    ).toBe(2);
  });
  it('rolls back disconnection if its durable doctor notification fails', async () => {
    const f = await fixture();
    const secretary = f.secretaries[0];
    await prisma.user.update({
      where: { id: secretary.id },
      data: { passwordHash: await passwords.hashStrong(password) },
    });
    const invite = await service.create(f.doctor.id, {
      ...coveragePlan('2027-01-04', '2027-01-05'),
      practiceLocationId: f.clinic.id,
      identifier: secretary.email!,
    });
    await service.acceptPendingById(secretary.id, invite.invitationId);
    const connection = await prisma.practiceStaff.findFirstOrThrow({
      where: { userId: secretary.id },
    });
    const failingPrisma = {
      $transaction: (
        callback: (
          tx: import('../generated/prisma/client').Prisma.TransactionClient,
        ) => Promise<unknown>,
      ) =>
        prisma.$transaction(async (tx) =>
          callback(
            new Proxy(tx, {
              get(target, property) {
                if (property === 'applicationNotification')
                  return {
                    create: () => {
                      throw new Error('notification failure');
                    },
                  };
                return Reflect.get(target, property) as unknown;
              },
            }),
          ),
        ),
    };
    const failing = new SecretaryInvitationService(
      failingPrisma as unknown as PrismaService,
      config,
      new ProtectedAccountPayloadService(config),
      new NotificationPayloadService(config),
      passwords,
      mobile,
    );
    await expect(
      failing.disconnectSelf(secretary.id, connection.id, password),
    ).rejects.toThrow('notification failure');
    expect(
      (
        await prisma.practiceStaff.findUniqueOrThrow({
          where: { id: connection.id },
        })
      ).isActive,
    ).toBe(true);
    expect(
      await prisma.substituteSecretaryCoverage.count({
        where: { practiceStaffId: connection.id, status: 'ACTIVE' },
      }),
    ).toBe(1);
    await service.disconnectSelf(secretary.id, connection.id, password);
    expect(
      await prisma.substituteSecretaryCoverage.count({
        where: { practiceStaffId: connection.id, status: 'ACTIVE' },
      }),
    ).toBe(0);
    expect(
      await prisma.substituteSecretaryCoverage.count({
        where: { practiceStaffId: connection.id, status: 'CANCELLED' },
      }),
    ).toBe(1);
  });
  it('lists connected secretaries across doctor clinics and statuses but excludes doctor-removed relationships', async () => {
    const f = await fixture();
    const outsider = await fixture();
    const clinic2 = await prisma.practiceLocation.create({
      data: {
        doctorProfileId: f.clinic.doctorProfileId,
        name: 'Other doctor clinic',
        timeZone: 'Asia/Manila',
        countryCode: 'PH',
      },
    });
    for (const secretary of f.secretaries) {
      const invite = await service.create(f.doctor.id, {
        ...coveragePlan('2027-01-04', '2027-01-04'),
        practiceLocationId: f.clinic.id,
        identifier: secretary.email!,
      });
      await service.acceptPendingById(secretary.id, invite.invitationId);
    }
    // One clinic-disabled connection, one secretary who left, and one doctor removal.
    const [disabled, left, removed] = f.secretaries;
    await prisma.practiceStaff.updateMany({
      where: { userId: disabled.id },
      data: { isActive: false },
    });
    await prisma.user.update({
      where: { id: left.id },
      data: { passwordHash: await passwords.hashStrong(password) },
    });
    const leftAssignment = await prisma.practiceStaff.findFirstOrThrow({
      where: { userId: left.id },
    });
    await service.disconnectSelf(left.id, leftAssignment.id, password);
    await prisma.practiceStaff.updateMany({
      where: { userId: removed.id },
      data: {
        isActive: false,
        disconnectedAt: new Date(),
        removedByDoctorAt: new Date(),
      },
    });
    const reader = new PracticeLocationStaffReadService(prisma);
    const candidates = (await reader.getClinicStaff(f.doctor.id, clinic2.id))
      .candidates;
    expect(candidates.map((c) => c.userId).sort()).toEqual(
      [disabled.id, left.id].sort(),
    );
    expect(
      (await reader.getClinicStaff(outsider.doctor.id, outsider.clinic.id))
        .candidates,
    ).toHaveLength(0);
    const invite = await service.create(f.doctor.id, {
      ...coveragePlan('2027-01-11', '2027-01-11'),
      practiceLocationId: f.clinic.id,
      identifier: left.email!,
    });
    expect(
      (
        await prisma.practiceStaff.findUniqueOrThrow({
          where: { id: leftAssignment.id },
        })
      ).isActive,
    ).toBe(false);
    await service.acceptPendingById(left.id, invite.invitationId);
    expect(
      (
        await prisma.practiceStaff.findUniqueOrThrow({
          where: { id: leftAssignment.id },
        })
      ).disconnectedAt,
    ).toBeNull();
  });
});
