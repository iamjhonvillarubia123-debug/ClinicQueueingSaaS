import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { randomInt, randomUUID } from 'crypto';
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
  Weekday,
} from './../generated/prisma/client';
import { AppModule } from './../src/app.module';
import { NotificationPayloadService } from './../src/notification/notification-payload.service';
import { PrismaService } from './../src/prisma/prisma.service';

describe('Individual booking confirmation endpoint (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let notificationPayload: NotificationPayloadService;

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
    }).compile();

    prisma = moduleFixture.get(PrismaService);
    notificationPayload = moduleFixture.get(NotificationPayloadService);
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
    const weekdays = [
      Weekday.SUNDAY,
      Weekday.MONDAY,
      Weekday.TUESDAY,
      Weekday.WEDNESDAY,
      Weekday.THURSDAY,
      Weekday.FRIDAY,
      Weekday.SATURDAY,
    ];
    const weekday = weekdays[serviceDate.getUTCDay()];
    if (!weekday) throw new Error('Unable to resolve service-date weekday.');

    const doctor = await prisma.user.create({
      data: {
        email: `m6s2-doctor-${scope}@example.test`,
        firstName: 'M6S2',
        lastName: 'Doctor',
        mobileNumber: `0918${String(randomInt(0, 10_000_000)).padStart(7, '0')}`,
        passwordHash: 'e2e-only-not-a-real-password-hash',
        role: UserRole.DOCTOR,
        accountStatus: UserAccountStatus.ACTIVE,
        administrativeRestrictionStatus: AdministrativeRestrictionStatus.NONE,
        emailVerifiedAt: new Date(),
      },
    });
    const profile = await prisma.doctorProfile.create({
      data: {
        userId: doctor.id,
        professionalTitle: 'Dr.',
        specialization: 'Family Medicine',
        licenseNumber: `M6S2-${scope}`,
      },
    });
    await prisma.doctorAccountSettings.create({
      data: {
        doctorProfileId: profile.id,
        allowOnlineBooking: true,
        maximumEstimatedServiceMinutesPerPatient: 120,
      },
    });
    const financialAccount = await prisma.doctorFinancialAccount.create({
      data: { doctorUserId: doctor.id },
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
        doctorProfileId: profile.id,
        lifecycleStatus: PracticeLocationLifecycleStatus.ACTIVE,
        isBookingEnabled: true,
        name: 'M6S2 Confirmation Clinic',
        addressLine1: '1 Confirmation Street',
        cityMunicipality: 'Quezon City',
        province: 'Metro Manila',
        postalCode: '1100',
        countryCode: 'PH',
        timeZone: 'Asia/Manila',
      },
    });
    await prisma.practiceSchedule.create({
      data: {
        practiceLocationId: location.id,
        weekday,
        isOpen: true,
        opensAtLocal: new Date('1970-01-01T00:00:00.000Z'),
        closesAtLocal: new Date('1970-01-01T23:59:00.000Z'),
      },
    });
    const selectedService = await prisma.practiceLocationService.create({
      data: {
        practiceLocationId: location.id,
        name: 'Initial Consultation',
        durationMinutes: 30,
        status: ServiceAvailabilityStatus.ACTIVE,
      },
    });

    const draftResponse = await request(app.getHttpServer())
      .post('/booking/draft')
      .send({
        practiceLocationId: location.id,
        mode: 'INDIVIDUAL',
        firstName: 'Maria',
        lastName: 'Patient',
        existingPatientResponse: 'NO',
        mobileNumber: patientMobile,
        serviceDate: serviceDateText,
        selectedServiceIds: [selectedService.id],
        privacyNoticeVersion: 'm6s2-e2e',
        privacyNoticeAcknowledged: true,
      })
      .expect(201);
    const draftBody = draftResponse.body as unknown as {
      bookingDraft: { id: string; bookingReference: string };
      otpVerification: { id: string } | null;
    };
    const bookingDraftId = draftBody.bookingDraft.id;
    const otpVerificationId = draftBody.otpVerification?.id;
    if (!otpVerificationId) {
      throw new Error('Booking draft did not issue an OTP challenge.');
    }

    const otpOutbox = await prisma.notificationOutbox.findFirstOrThrow({
      where: {
        otpVerificationId,
        notificationType: NotificationType.OTP_VERIFICATION,
      },
      select: { messageBodyEncrypted: true },
    });
    if (!otpOutbox.messageBodyEncrypted) {
      throw new Error(
        'Booking OTP outbox did not contain a protected message.',
      );
    }
    const otpMessage = notificationPayload.decryptMessage(
      otpOutbox.messageBodyEncrypted,
    );
    const otp = otpMessage.match(/\b(\d{6})\b/)?.[1];
    if (!otp) {
      throw new Error('Booking OTP message did not contain a six-digit code.');
    }

    await request(app.getHttpServer())
      .post('/booking/verify-otp')
      .send({ bookingDraftId, otp })
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
      bookingAccessToken: {
        expiresAt: string;
        transport: string;
        token?: string;
      };
      replayed: boolean;
    };

    expect(firstBody.replayed).toBe(false);
    expect(firstBody.appointment.bookingReference).toBe(
      draftBody.bookingDraft.bookingReference,
    );
    expect(firstBody.appointment.queueNumber).toBe(1);
    expect(firstBody.appointment.status).toBe('WAITING');
    expect(firstBody.bookingAccessToken.transport).toBe('HTTP_ONLY_COOKIE');
    expect(typeof firstBody.bookingAccessToken.expiresAt).toBe('string');
    expect(firstBody.bookingAccessToken.expiresAt.length).toBeGreaterThan(0);
    expect(firstBody.bookingAccessToken).not.toHaveProperty('token');

    const firstCookies = firstResponse.headers['set-cookie'];
    expect(firstCookies).toEqual(expect.any(Array));
    const bookingCookie = (firstCookies as unknown as string[]).find((value) =>
      value.startsWith('cq_booking_access='),
    );
    expect(bookingCookie).toEqual(expect.any(String));
    expect(bookingCookie).toContain('HttpOnly');
    expect(bookingCookie).toContain('Secure');
    expect(bookingCookie).toContain('SameSite=Strict');
    expect(bookingCookie).toContain(
      `Path=/patient-bookings/${encodeURIComponent(firstBody.appointment.bookingReference)}`,
    );

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

    const [appointments, counter, commandRows, confirmationOutboxes] =
      await Promise.all([
        prisma.appointment.findMany({
          where: {
            practiceLocationId: location.id,
            serviceDate,
          },
        }),
        prisma.queueCounter.findUnique({
          where: {
            practiceLocationId_serviceDate: {
              practiceLocationId: location.id,
              serviceDate,
            },
          },
        }),
        prisma.commandIdempotency.findMany({
          where: {
            bookingDraftId,
            commandType: CommandType.CONVERT_BOOKING_DRAFT,
          },
        }),
        prisma.notificationOutbox.findMany({
          where: {
            appointmentId: firstBody.appointment.id,
            notificationType: NotificationType.BOOKING_CONFIRMATION,
          },
        }),
      ]);

    expect(appointments).toHaveLength(1);
    expect(appointments[0]?.queueNumber).toBe(1);
    expect(counter?.lastAllocatedNumber).toBe(1);
    expect(commandRows).toHaveLength(1);
    expect(confirmationOutboxes).toHaveLength(1);
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

    const cookiePair = bookingCookie?.split(';', 1)[0];
    const rawAccessToken = cookiePair?.split('=', 2)[1];
    if (!rawAccessToken) {
      throw new Error(
        'Initial booking confirmation did not issue an access cookie.',
      );
    }
    const encryptedMessage = confirmationOutboxes[0].messageBodyEncrypted;
    if (!encryptedMessage) {
      throw new Error(
        'Confirmation outbox did not contain an encrypted message.',
      );
    }
    expect(encryptedMessage).not.toContain(rawAccessToken);
    const decryptedMessage =
      notificationPayload.decryptMessage(encryptedMessage);
    expect(decryptedMessage).toContain('Queue number: 1.');
    expect(decryptedMessage).toContain(
      `https://app.example.test/booking/access#token=${encodeURIComponent(rawAccessToken)}`,
    );
  }, 30_000);
});
