import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import {
  AdministrativeRestrictionStatus,
  PracticeLocationLifecycleStatus,
  UserAccountStatus,
  UserRole,
} from './../generated/prisma/client';
import { NotificationPayloadService } from './../src/notification/notification-payload.service';
import { OtpNotificationOutboxService } from './../src/notification/otp-notification-outbox.service';
import { OtpGenerator } from './../src/otp/otp.generator';
import { OtpService } from './../src/otp/otp.service';
import { PrismaService } from './../src/prisma/prisma.service';

describe('Booking OTP concurrency controls (e2e)', () => {
  let prisma: PrismaService;
  let otpService: OtpService;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();

    const values: Record<string, string> = {
      OTP_HMAC_KEY_V1: Buffer.alloc(32, 3).toString('base64'),
      OTP_HMAC_ACTIVE_KEY_ID: 'v1',
      MOBILE_ENCRYPTION_KEY_V1: Buffer.alloc(32, 4).toString('base64'),
      MOBILE_ENCRYPTION_ACTIVE_KEY_ID: 'e2e-mobile-v1',
    };
    const config = {
      getOrThrow: (name: string) => {
        const value = values[name];
        if (!value) throw new Error(`Missing test configuration: ${name}`);
        return value;
      },
    } as unknown as ConfigService;
    const notificationPayload = new NotificationPayloadService(config);
    const otpNotificationOutbox = new OtpNotificationOutboxService(
      notificationPayload,
    );

    otpService = new OtpService(
      new OtpGenerator(),
      config,
      prisma,
      otpNotificationOutbox,
    );
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('serializes concurrent resend so exactly one replacement challenge becomes active', async () => {
    const scope = randomUUID().replaceAll('-', '');
    const doctorUser = await prisma.user.create({
      data: {
        email: `m5s4a-doctor-${scope.slice(0, 12)}@example.test`,
        firstName: 'Otp',
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
        specialization: 'OTP Concurrency',
        licenseNumber: `OTP-${scope.slice(0, 12)}`,
      },
    });
    const location = await prisma.practiceLocation.create({
      data: {
        doctorProfileId: doctorProfile.id,
        lifecycleStatus: PracticeLocationLifecycleStatus.ACTIVE,
        name: `OTP Concurrency ${scope.slice(0, 8)}`,
        countryCode: 'PH',
        timeZone: 'Asia/Manila',
      },
    });
    const draft = await prisma.bookingDraft.create({
      data: {
        bookingReference: `OTP${scope.slice(0, 12)}`,
        practiceLocationId: location.id,
        firstName: 'Concurrent',
        lastName: 'Patient',
        mobileNumberEncrypted: `e2e-encrypted-${scope}`,
        mobileNumberHash: scope.repeat(2),
        mobileNumberLastFour: '4567',
        serviceDate: new Date('2026-08-17T00:00:00.000Z'),
        estimatedServiceMinutes: 30,
        expiresAt: new Date(Date.now() + 30 * 60 * 1000),
      },
    });

    const initial = await otpService.createBookingOtp(draft.id);
    await prisma.otpVerification.update({
      where: { id: initial.otpVerification.id },
      data: { createdAt: new Date(Date.now() - 61 * 1000) },
    });

    const results = await Promise.allSettled([
      otpService.createBookingOtp(draft.id),
      otpService.createBookingOtp(draft.id),
    ]);

    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === 'rejected'),
    ).toHaveLength(1);

    const challenges = await prisma.otpVerification.findMany({
      where: { bookingDraftId: draft.id, purpose: 'BOOKING' },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        activeContextKey: true,
        invalidatedAt: true,
        otpHash: true,
      },
    });
    const active = challenges.filter(
      (challenge) => challenge.activeContextKey !== null,
    );
    const outboxes = await prisma.notificationOutbox.findMany({
      where: {
        otpVerificationId: { in: challenges.map((challenge) => challenge.id) },
      },
      select: {
        otpVerificationId: true,
        notificationType: true,
        recipientMobileEncrypted: true,
        messageBodyEncrypted: true,
      },
    });

    expect(challenges).toHaveLength(2);
    expect(active).toHaveLength(1);
    expect(active[0]?.activeContextKey).toBe(`BOOKING:${draft.id}`);
    expect(challenges[0]?.invalidatedAt).not.toBeNull();
    expect(challenges[0]?.otpHash).toBeNull();
    expect(outboxes).toHaveLength(2);
    expect(
      new Set(outboxes.map((outbox) => outbox.otpVerificationId)).size,
    ).toBe(2);
    expect(
      outboxes.every(
        (outbox) =>
          outbox.notificationType === 'OTP_VERIFICATION' &&
          outbox.recipientMobileEncrypted !== null &&
          outbox.messageBodyEncrypted !== null,
      ),
    ).toBe(true);
  });
});
