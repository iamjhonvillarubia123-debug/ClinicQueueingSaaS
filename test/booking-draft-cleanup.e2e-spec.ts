import { randomUUID } from 'crypto';
import {
  AdministrativeRestrictionStatus,
  BookingDraftMode,
  PracticeLocationLifecycleStatus,
  UserAccountStatus,
  UserRole,
} from './../generated/prisma/client';
import { BookingDraftCleanupService } from './../src/booking/booking-draft-cleanup.service';
import { PrismaService } from './../src/prisma/prisma.service';

describe('BookingDraft cleanup concurrency (e2e)', () => {
  let prisma: PrismaService;
  let cleanup: BookingDraftCleanupService;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    cleanup = new BookingDraftCleanupService(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('serializes expiration and clears protected identity after the retention window', async () => {
    const scope = randomUUID().replaceAll('-', '');
    const doctorUser = await prisma.user.create({
      data: {
        email: `m5s5a-doctor-${scope.slice(0, 12)}@example.test`,
        firstName: 'Cleanup',
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
        specialization: 'Cleanup Testing',
        licenseNumber: `M5S5A-${scope.slice(0, 12)}`,
      },
    });
    const location = await prisma.practiceLocation.create({
      data: {
        doctorProfileId: doctorProfile.id,
        lifecycleStatus: PracticeLocationLifecycleStatus.ACTIVE,
        name: `Cleanup Clinic ${scope.slice(0, 8)}`,
        countryCode: 'PH',
        timeZone: 'Asia/Manila',
      },
    });

    const expiredDeadline = new Date(Date.now() - 60_000);
    const createdAt = new Date(expiredDeadline.getTime() - 30 * 60 * 1000);
    const draft = await prisma.bookingDraft.create({
      data: {
        bookingReference: `M5S5A${scope.slice(0, 10)}`,
        mode: BookingDraftMode.MULTI_PERSON,
        practiceLocationId: location.id,
        mobileNumberEncrypted: 'e2e-protected-mobile',
        mobileNumberHash: 'a'.repeat(64),
        mobileNumberLastFour: '4567',
        draftControlTokenHash: 'b'.repeat(64),
        serviceDate: new Date('2026-08-20T00:00:00.000Z'),
        createdAt,
        expiresAt: expiredDeadline,
      },
    });
    await prisma.bookingDraftMember.create({
      data: {
        bookingDraftId: draft.id,
        memberOrder: 1,
        firstName: 'Temporary',
        lastName: 'Member',
      },
    });

    const transitionNow = new Date();
    const results = await Promise.all([
      cleanup.expirePendingDrafts(1, transitionNow),
      cleanup.expirePendingDrafts(1, transitionNow),
    ]);

    expect(results.reduce((sum, count) => sum + count, 0)).toBe(1);

    const terminalRows = await prisma.$queryRaw<
      Array<{ status: string; expiredAt: Date | null }>
    >`
      SELECT "status", "expiredAt"
      FROM "BookingDraft"
      WHERE "id" = ${draft.id}
    `;
    expect(terminalRows[0]?.status).toBe('EXPIRED');
    expect(terminalRows[0]?.expiredAt).not.toBeNull();

    const cleanupNow = new Date(transitionNow.getTime() + 25 * 60 * 60 * 1000);
    await expect(
      cleanup.clearTerminalProtectedData(10, cleanupNow),
    ).resolves.toBeGreaterThanOrEqual(1);

    const cleanedRows = await prisma.$queryRaw<
      Array<{
        bookingReference: string | null;
        firstName: string | null;
        mobileNumberHash: string | null;
        draftControlTokenHash: string | null;
        protectedDataClearedAt: Date | null;
      }>
    >`
      SELECT
        "bookingReference",
        "firstName",
        "mobileNumberHash",
        "draftControlTokenHash",
        "protectedDataClearedAt"
      FROM "BookingDraft"
      WHERE "id" = ${draft.id}
    `;
    expect(cleanedRows[0]).toMatchObject({
      bookingReference: null,
      firstName: null,
      mobileNumberHash: null,
      draftControlTokenHash: null,
    });
    expect(cleanedRows[0]?.protectedDataClearedAt).not.toBeNull();

    const memberRows = await prisma.$queryRaw<
      Array<{ firstName: string | null; lastName: string | null }>
    >`
      SELECT "firstName", "lastName"
      FROM "BookingDraftMember"
      WHERE "bookingDraftId" = ${draft.id}
    `;
    expect(memberRows[0]).toEqual({ firstName: null, lastName: null });
  });
});
