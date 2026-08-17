import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { randomInt, randomUUID } from 'crypto';
import request from 'supertest';
import { App } from 'supertest/types';
import {
  AdministrativeRestrictionStatus,
  BookingQuestionType,
  CommandType,
  PracticeLocationLifecycleStatus,
  ServiceAvailabilityStatus,
  UserAccountStatus,
  UserRole,
} from './../generated/prisma/client';
import { AppModule } from './../src/app.module';
import { OtpGenerator } from './../src/otp/otp.generator';
import { PrismaService } from './../src/prisma/prisma.service';

const KNOWN_BOOKING_OTP = '123456';

type ConfirmationFixture = {
  scope: string;
  serviceDate: Date;
  locationId: string;
  serviceId: string;
  bookingDraftId: string;
  otpVerificationId: string;
  questionId: string | null;
};

describe('Individual booking confirmation current-state revalidation (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  const testEnvironment: Record<string, string> = {
    JWT_SECRET: 'm6s2-revalidation-e2e-only-jwt-secret',
    MOBILE_ENCRYPTION_KEY_V1: Buffer.alloc(32, 21).toString('base64'),
    MOBILE_LOOKUP_HMAC_KEY_V1: Buffer.alloc(32, 22).toString('base64'),
    MOBILE_ENCRYPTION_ACTIVE_KEY_ID: 'm6s2-revalidation-mobile-v1',
    MOBILE_LOOKUP_ACTIVE_KEY_ID: 'm6s2-revalidation-lookup-v1',
    OTP_HMAC_KEY_V1: Buffer.alloc(32, 23).toString('base64'),
    OTP_HMAC_ACTIVE_KEY_ID: 'm6s2-revalidation-otp-v1',
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

  it('rejects an inactive selected Service before Queue Number allocation and preserves the verified draft/OTP', async () => {
    const fixture = await createFixture(false);

    await prisma.practiceLocationService.update({
      where: { id: fixture.serviceId },
      data: { status: ServiceAvailabilityStatus.INACTIVE },
    });

    await request(app.getHttpServer())
      .post(`/booking/draft/${fixture.bookingDraftId}/confirm`)
      .set('Idempotency-Key', `m6s2-revalidate-service-${fixture.scope}`)
      .expect(409);

    await expectRejectedConfirmationState(fixture);
  });

  it('rejects when the current required BookingQuestion set is no longer satisfied and preserves the verified draft/OTP', async () => {
    const fixture = await createFixture(true);
    if (!fixture.questionId) {
      throw new Error('BookingQuestion fixture was not created.');
    }

    await prisma.bookingQuestion.update({
      where: { id: fixture.questionId },
      data: { isActive: false },
    });
    await prisma.bookingQuestion.create({
      data: {
        practiceLocationId: fixture.locationId,
        questionText: 'New current required confirmation question?',
        type: BookingQuestionType.TEXT,
        isRequired: true,
        displayOrder: 1,
        textMaximumLength: 100,
      },
    });

    await request(app.getHttpServer())
      .post(`/booking/draft/${fixture.bookingDraftId}/confirm`)
      .set('Idempotency-Key', `m6s2-revalidate-question-${fixture.scope}`)
      .expect(409);

    await expectRejectedConfirmationState(fixture);
  });

  async function createFixture(
    includeRequiredQuestion: boolean,
  ): Promise<ConfirmationFixture> {
    const scope = randomUUID().replaceAll('-', '');
    const patientMobile = `0917${String(randomInt(0, 10_000_000)).padStart(7, '0')}`;
    const serviceDate = new Date();
    serviceDate.setUTCDate(serviceDate.getUTCDate() + 4);
    serviceDate.setUTCHours(0, 0, 0, 0);
    const serviceDateText = serviceDate.toISOString().slice(0, 10);
    const localTime = (hour: number) => new Date(Date.UTC(1970, 0, 1, hour));

    const doctorUser = await prisma.user.create({
      data: {
        email: `m6s2-revalidation-${scope.slice(0, 12)}@example.test`,
        firstName: 'Revalidation',
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
        specialization: 'Revalidation Testing',
        licenseNumber: `M6RV-${scope.slice(0, 12)}`,
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
        name: `M6 Revalidation ${scope.slice(0, 8)}`,
        countryCode: 'PH',
        timeZone: 'Asia/Manila',
      },
    });
    const service = await prisma.practiceLocationService.create({
      data: {
        practiceLocationId: location.id,
        name: 'Revalidation Service',
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

    const question = includeRequiredQuestion
      ? await prisma.bookingQuestion.create({
          data: {
            practiceLocationId: location.id,
            questionText: 'Current required booking question?',
            type: BookingQuestionType.TEXT,
            isRequired: true,
            displayOrder: 0,
            textMaximumLength: 100,
          },
        })
      : null;

    const draftResponse = await request(app.getHttpServer())
      .post('/booking/draft')
      .send({
        practiceLocationId: location.id,
        mode: 'INDIVIDUAL',
        firstName: 'Maria',
        lastName: 'Reyes',
        existingPatientResponse: 'NO',
        mobileNumber: patientMobile,
        serviceDate: serviceDateText,
        privacyNoticeVersion: 'm6s2-revalidation-v1',
        privacyNoticeAcknowledged: true,
        selectedServiceIds: [service.id],
        answers: question
          ? [
              {
                bookingQuestionId: question.id,
                answerText: 'Original valid answer',
              },
            ]
          : undefined,
      })
      .expect(201);

    const draftBody = draftResponse.body as unknown as {
      bookingDraft: { id: string };
      otpVerification: { id: string } | null;
    };
    if (!draftBody.otpVerification) {
      throw new Error('Booking draft did not issue an OTP challenge.');
    }

    await request(app.getHttpServer())
      .post('/booking/verify-otp')
      .send({
        bookingDraftId: draftBody.bookingDraft.id,
        otp: KNOWN_BOOKING_OTP,
      })
      .expect(201);

    return {
      scope,
      serviceDate,
      locationId: location.id,
      serviceId: service.id,
      bookingDraftId: draftBody.bookingDraft.id,
      otpVerificationId: draftBody.otpVerification.id,
      questionId: question?.id ?? null,
    };
  }

  async function expectRejectedConfirmationState(fixture: ConfirmationFixture) {
    const [
      counter,
      appointmentCount,
      commandCount,
      draft,
      otpVerification,
    ] = await Promise.all([
      prisma.queueCounter.findUnique({
        where: {
          practiceLocationId_serviceDate: {
            practiceLocationId: fixture.locationId,
            serviceDate: fixture.serviceDate,
          },
        },
      }),
      prisma.appointment.count({
        where: {
          practiceLocationId: fixture.locationId,
          serviceDate: fixture.serviceDate,
        },
      }),
      prisma.commandIdempotency.count({
        where: {
          commandType: CommandType.CONVERT_BOOKING_DRAFT,
          bookingDraftId: fixture.bookingDraftId,
        },
      }),
      prisma.bookingDraft.findUniqueOrThrow({
        where: { id: fixture.bookingDraftId },
      }),
      prisma.otpVerification.findUniqueOrThrow({
        where: { id: fixture.otpVerificationId },
      }),
    ]);

    expect(counter).toBeNull();
    expect(appointmentCount).toBe(0);
    expect(commandCount).toBe(0);
    expect(draft.status).not.toBe('CONSUMED');
    expect(draft.consumedAt).toBeNull();
    expect(draft.activeDraftKey).not.toBeNull();
    expect(draft.draftControlTokenHash).not.toBeNull();
    expect(otpVerification.verifiedAt).not.toBeNull();
    expect(otpVerification.consumedAt).toBeNull();
    expect(otpVerification.activeContextKey).not.toBeNull();
    expect(otpVerification.otpHash).not.toBeNull();
  }
});
