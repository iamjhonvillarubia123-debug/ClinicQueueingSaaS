import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { createDecipheriv, createHmac, randomInt, randomUUID } from 'crypto';
import request from 'supertest';
import { App } from 'supertest/types';
import {
  AdministrativeRestrictionStatus,
  CommandType,
  NotificationType,
  PracticeLocationLifecycleStatus,
  ServiceAvailabilityStatus,
  UserAccountStatus,
  UserRole,
} from './../generated/prisma/client';
import { AppModule } from './../src/app.module';
import { OtpGenerator } from './../src/otp/otp.generator';
import { PrismaService } from './../src/prisma/prisma.service';

const KNOWN_BOOKING_OTP = '123456';
const NOTIFICATION_KEY_PURPOSE = 'notification-outbox-message-v1';

describe('Individual booking confirmation endpoint (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  const testEnvironment: Record<string, string> = {
    JWT_SECRET: 'm6s2-e2e-only-jwt-secret-not-for-production',
    MOBILE_ENCRYPTION_KEY_V1: Buffer.alloc(32, 11).toString('base64'),
    MOBILE_LOOKUP_HMAC_KEY_V1: Buffer.alloc(32, 12).toString('base64'),
    MOBILE_ENCRYPTION_ACTIVE_KEY_ID: 'm6s2-mobile-encryption-v1',
    MOBILE_LOOKUP_ACTIVE_KEY_ID: 'm6s2-mobile-lookup-v1',
    OTP_HMAC_KEY_V1: Buffer.alloc(32, 13).toString('base64'),
    OTP_HMAC_ACTIVE_KEY_ID: 'm6s2-otp-hmac-v1',
    PUBLIC_APP_BASE_URL: 'https://app.example.test',
    WEB_APP_ORIGIN: 'https://app.example.test',
  };
  const originalEnvironment: Record<string, string | undefined> = {};

  beforeAll(async () => {
    for (const [key, value] of Object.entries(testEnvironment)) {
      originalEnvironment[key] = process.env[key];
      process.env[key] = value;
    }

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(OtpGenerator)
      .useValue({ generate: () => KNOWN_BOOKING_OTP })
      .compile();

    prisma = moduleFixture.get(PrismaService);
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    for (const [key, value] of Object.entries(originalEnvironment)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  it('confirms once, persists current authoritative state, and replays without a second token or Queue Number', async () => {
    const scope = randomUUID().replaceAll('-', '');
    const patientMobile = `0917${String(randomInt(0, 10_000_000)).padStart(7, '0')}`;
    const serviceDate = new Date();
    serviceDate.setUTCDate(serviceDate.getUTCDate() + 3);
    serviceDate.setUTCHours(0, 0, 0, 0);
    const serviceDateText = serviceDate.toISOString().slice(0, 10);
    const localTime = (hour: number, minute = 0) =>
      new Date(Date.UTC(1970, 0, 1, hour, minute));

    const doctorUser = await prisma.user.create({
      data: {
        email: `m6s2-confirm-${scope.slice(0, 12)}@example.test`,
        firstName: 'Confirm',
        lastName: 'Doctor',
        mobileNumber: `0918${String(randomInt(0, 10_000_000)).padStart(7, '0')}`,
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
        specialization: 'Confirmation Testing',
        licenseNumber: `M6C-${scope.slice(0, 12)}`,
      },
    });
    await prisma.doctorAccountSettings.create({
      data: {
        doctorProfileId: doctorProfile.id,
        allowOnlineBooking: true,
        maximumAdvanceBookingDays: 30,
        maximumEstimatedServiceMinutesPerPatient: 120,
      },
    });
    const financialAccount = await prisma.doctorFinancialAccount.create({
      data: { doctorUserId: doctorUser.id },
    });
    await prisma.doctorSubscriptionEntitlement.create({
      data: {
        doctorFinancialAccountId: financialAccount.id,
        paidThrough: new Date(serviceDate.getTime() + 20 * 24 * 60 * 60 * 1000),
        graceEndsAt: new Date(serviceDate.getTime() + 27 * 24 * 60 * 60 * 1000),
      },
    });
    const location = await prisma.practiceLocation.create({
      data: {
        doctorProfileId: doctorProfile.id,
        lifecycleStatus: PracticeLocationLifecycleStatus.ACTIVE,
        isBookingEnabled: true,
        name: `M6 Confirmation ${scope.slice(0, 8)}`,
        countryCode: 'PH',
        timeZone: 'Asia/Manila',
      },
    });
    const selectedService = await prisma.practiceLocationService.create({
      data: {
        practiceLocationId: location.id,
        name: 'Endpoint Confirmation Service',
        durationMinutes: 30,
        status: ServiceAvailabilityStatus.ACTIVE,
      },
    });
    await prisma.scheduleException.create({
      data: {
        practiceLocationId: location.id,
        serviceDate,
        isOpen: true,
        opensAtLocal: localTime(8),
        closesAtLocal: localTime(17),
        maximumOperatingUntilLocal: localTime(18),
      },
    });

    const draftResponse = await request(app.getHttpServer())
      .post('/booking/draft')
      .send({
        practiceLocationId: location.id,
        mode: 'INDIVIDUAL',
        firstName: 'Maria',
        middleName: 'Santos',
        lastName: 'Reyes',
        existingPatientResponse: 'NO',
        mobileNumber: patientMobile,
        serviceDate: serviceDateText,
        privacyNoticeVersion: 'm6s2-e2e-v1',
        privacyNoticeAcknowledged: true,
        scheduledReminderOptIn: true,
        selectedServiceIds: [selectedService.id],
      })
      .expect(201);

    const draftBody = draftResponse.body as unknown as {
      bookingDraft: { id: string; bookingReference: string };
      otpVerification: { id: string } | null;
    };
    const bookingDraftId = draftBody.bookingDraft.id;
    if (!draftBody.otpVerification) {
      throw new Error('Booking draft did not issue an OTP challenge.');
    }

    await request(app.getHttpServer())
      .post('/booking/verify-otp')
      .send({ bookingDraftId, otp: KNOWN_BOOKING_OTP })
      .expect(201);

    await prisma.practiceLocationService.update({
      where: { id: selectedService.id },
      data: { durationMinutes: 45 },
    });

    const idempotencyKey = `m6s2-confirm-${scope}`;
    const firstResponse = await request(app.getHttpServer())
      .post(`/booking/draft/${bookingDraftId}/confirm`)
      .set('Idempotency-Key', idempotencyKey)
      .expect(201);
    const firstBody = firstResponse.body as unknown as {
      appointment: {
        id: string;
        bookingReference: string;
        queueNumber: number;
        status: string;
      };
      bookingAccessToken: { token: string; expiresAt: string } | null;
      replayed: boolean;
    };

    expect(firstBody.replayed).toBe(false);
    expect(firstBody.appointment.bookingReference).toBe(
      draftBody.bookingDraft.bookingReference,
    );
    expect(firstBody.appointment.queueNumber).toBe(1);
    expect(firstBody.appointment.status).toBe('WAITING');
    expect(firstBody.bookingAccessToken?.token).toEqual(expect.any(String));

    const replayResponse = await request(app.getHttpServer())
      .post(`/booking/draft/${bookingDraftId}/confirm`)
      .set('Idempotency-Key', idempotencyKey)
      .expect(201);
    const replayBody = replayResponse.body as unknown as {
      appointment: { id: string; queueNumber: number };
      bookingAccessToken: null;
      replayed: boolean;
    };

    expect(replayBody).toMatchObject({
      appointment: {
        id: firstBody.appointment.id,
        queueNumber: 1,
      },
      bookingAccessToken: null,
      replayed: true,
    });

    const [
      appointmentCount,
      appointment,
      counter,
      draft,
      verifiedOtp,
      contactPreference,
      bookedServices,
      accessTokens,
      confirmationOutboxes,
      commandRows,
    ] = await Promise.all([
      prisma.appointment.count({
        where: { bookingReference: firstBody.appointment.bookingReference },
      }),
      prisma.appointment.findUnique({
        where: { id: firstBody.appointment.id },
      }),
      prisma.queueCounter.findUnique({
        where: {
          practiceLocationId_serviceDate: {
            practiceLocationId: location.id,
            serviceDate,
          },
        },
      }),
      prisma.bookingDraft.findUnique({ where: { id: bookingDraftId } }),
      prisma.otpVerification.findUnique({
        where: { id: draftBody.otpVerification.id },
      }),
      prisma.contactPreference.findUnique({
        where: { appointmentId: firstBody.appointment.id },
      }),
      prisma.appointmentBookedService.findMany({
        where: { appointmentId: firstBody.appointment.id },
      }),
      prisma.bookingAccessToken.findMany({
        where: { appointmentId: firstBody.appointment.id },
      }),
      prisma.notificationOutbox.findMany({
        where: {
          appointmentId: firstBody.appointment.id,
          notificationType: NotificationType.BOOKING_CONFIRMATION,
        },
      }),
      prisma.commandIdempotency.findMany({
        where: {
          commandType: CommandType.CONVERT_BOOKING_DRAFT,
          bookingDraftId,
        },
      }),
    ]);

    expect(appointmentCount).toBe(1);
    expect(appointment?.estimatedServiceMinutes).toBe(45);
    expect(counter?.lastAllocatedNumber).toBe(1);
    expect(draft).toMatchObject({
      status: 'CONSUMED',
      activeDraftKey: null,
      draftControlTokenHash: null,
    });
    expect(draft?.consumedAt).not.toBeNull();
    expect(verifiedOtp).toMatchObject({
      activeContextKey: null,
      otpHash: null,
      otpHashKeyVersion: null,
    });
    expect(verifiedOtp?.consumedAt).not.toBeNull();
    expect(contactPreference).toMatchObject({
      allowOperationalMessages: true,
      allowFollowUpReminder: true,
      allowMarketingMessages: false,
      privacyNoticeVersion: 'm6s2-e2e-v1',
    });
    expect(bookedServices).toHaveLength(1);
    expect(bookedServices[0]).toMatchObject({
      practiceLocationServiceId: selectedService.id,
      serviceNameSnapshot: 'Endpoint Confirmation Service',
      durationMinutesSnapshot: 45,
    });
    expect(accessTokens).toHaveLength(1);
    expect(accessTokens[0].tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(confirmationOutboxes).toHaveLength(1);
    expect(confirmationOutboxes[0].deliveryIdentityKey).toMatch(
      /^[0-9a-f]{64}$/,
    );
    expect(commandRows).toHaveLength(1);
    expect(commandRows[0]).toMatchObject({
      idempotencyKey,
      resultAppointmentId: firstBody.appointment.id,
      practiceLocationId: location.id,
    });
    expect(commandRows[0].completedAt.getTime()).toBeGreaterThanOrEqual(
      commandRows[0].createdAt.getTime(),
    );
    expect(commandRows[0].expiresAt.getTime()).toBe(
      commandRows[0].completedAt.getTime() + 7 * 24 * 60 * 60 * 1000,
    );
    expect(confirmationOutboxes[0].commandIdempotencyId).toBe(
      commandRows[0].id,
    );

    const rawAccessToken = firstBody.bookingAccessToken?.token;
    if (!rawAccessToken) {
      throw new Error('Initial booking confirmation did not return an access token.');
    }
    const encryptedMessage = confirmationOutboxes[0].messageBodyEncrypted;
    if (!encryptedMessage) {
      throw new Error('Confirmation outbox did not contain an encrypted message.');
    }
    expect(encryptedMessage).not.toContain(rawAccessToken);
    const decryptedMessage = decryptNotificationMessage(encryptedMessage);
    expect(decryptedMessage).toContain('Queue number: 1.');
    expect(decryptedMessage).toContain(
      `https://app.example.test/booking/access#token=${encodeURIComponent(rawAccessToken)}`,
    );
  }, 30_000);
});

function decryptNotificationMessage(payload: string): string {
  const [version, keyId, purpose, ivEncoded, tagEncoded, ciphertextEncoded] =
    payload.split('.');
  if (
    version !== 'v1' ||
    keyId !== 'm6s2-mobile-encryption-v1' ||
    purpose !== 'notification-outbox:message' ||
    !ivEncoded ||
    !tagEncoded ||
    !ciphertextEncoded
  ) {
    throw new Error('Unexpected encrypted notification payload format.');
  }

  const baseKey = Buffer.from(testNotificationBaseKey(), 'base64');
  const encryptionKey = createHmac('sha256', baseKey)
    .update(NOTIFICATION_KEY_PURPOSE, 'utf8')
    .digest();
  const decipher = createDecipheriv(
    'aes-256-gcm',
    encryptionKey,
    Buffer.from(ivEncoded, 'base64url'),
  );
  decipher.setAAD(Buffer.from(purpose, 'utf8'));
  decipher.setAuthTag(Buffer.from(tagEncoded, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextEncoded, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

function testNotificationBaseKey(): string {
  return Buffer.alloc(32, 11).toString('base64');
}
