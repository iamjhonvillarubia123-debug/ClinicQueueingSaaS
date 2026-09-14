import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { randomInt, randomUUID } from 'crypto';
import * as bcrypt from 'bcrypt';
import { Prisma } from '../generated/prisma/client';
import { MobileNumberService } from '../src/security/mobile-number/mobile-number.service';
import { SecretaryLifecycleService } from '../src/secretary/secretary-lifecycle.service';
import { NotificationPayloadService } from '../src/notification/notification-payload.service';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { ProtectedAccountPayloadService } from '../src/auth/security/protected-account-payload.service';
import { PrismaService } from '../src/prisma/prisma.service';

describe('R1 Secretary permanent account closure (e2e)', () => {
  let app: INestApplication<App> | undefined;
  let prisma: PrismaService;
  let protectedPayloadService: ProtectedAccountPayloadService;

  const testEnvironment: Record<string, string> = {
    JWT_SECRET: 'r1-permanent-closure-e2e-only-jwt-secret',
    MOBILE_ENCRYPTION_KEY_V1: Buffer.alloc(32, 21).toString('base64'),
    MOBILE_LOOKUP_HMAC_KEY_V1: Buffer.alloc(32, 22).toString('base64'),
    MOBILE_ENCRYPTION_ACTIVE_KEY_ID: 'r1-closure-mobile-encryption-v1',
    MOBILE_LOOKUP_ACTIVE_KEY_ID: 'r1-closure-mobile-lookup-v1',
    OTP_HMAC_KEY_V1: Buffer.alloc(32, 23).toString('base64'),
    OTP_HMAC_ACTIVE_KEY_ID: 'r1-closure-otp-hmac-v1',
    PUBLIC_APP_BASE_URL: 'https://app.example.test',
    WEB_APP_ORIGIN: 'https://app.example.test',
  };
  const originalEnvironment: Record<string, string | undefined> = {};

  beforeEach(async () => {
    for (const [key, value] of Object.entries(testEnvironment)) {
      originalEnvironment[key] = process.env[key];
      process.env[key] = value;
    }

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    prisma = moduleFixture.get(PrismaService);
    protectedPayloadService = moduleFixture.get(ProtectedAccountPayloadService);
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

  afterEach(async () => {
    if (app) await app.close();
    app = undefined;
    for (const [key, value] of Object.entries(originalEnvironment)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  async function verifyNewAccount(
    userId: string,
    identifierType: 'EMAIL' | 'MOBILE',
  ) {
    if (!app) throw new Error('E2E application did not initialize.');
    if (identifierType === 'EMAIL') {
      const challenge = await prisma.emailVerification.findFirstOrThrow({
        where: { userId, status: 'PENDING' },
        include: { notificationOutbox: true },
      });
      const encrypted = challenge.notificationOutbox?.messageBodyEncrypted;
      if (!encrypted)
        throw new Error('New email verification message missing.');
      const message = protectedPayloadService.decrypt(
        encrypted,
        'doctor-email-verification:message',
      );
      const url = message.match(/https:\/\/\S+/)?.[0];
      const token = url ? new URL(url).searchParams.get('token') : null;
      if (!token) throw new Error('New verification token missing.');
      await request(app.getHttpServer())
        .post('/auth/verify-email')
        .send({ token })
        .expect(201);
    } else {
      const challenge = await prisma.otpVerification.findFirstOrThrow({
        where: {
          userId,
          purpose: 'ACCOUNT_MOBILE_VERIFICATION',
          consumedAt: null,
        },
        include: { notificationOutbox: true },
      });
      const encrypted = challenge.notificationOutbox?.messageBodyEncrypted;
      if (!encrypted)
        throw new Error('New mobile verification message missing.');
      const otp = app
        .get(NotificationPayloadService)
        .decryptMessage(encrypted)
        .match(/\b\d{6}\b/)?.[0];
      if (!otp) throw new Error('New verification code missing.');
      await request(app.getHttpServer())
        .post('/auth/verify-mobile')
        .send({ userId, otp })
        .expect(201);
    }
  }

  it.each(['EMAIL', 'MOBILE'] as const)(
    'enforces %s ownership, rolls back audit failure, preserves history, and closes only current authority',
    async (identifierType) => {
      if (!app) throw new Error('E2E application did not initialize.');
      const unique = randomUUID();
      const password = 'Secretary-closure-fixture-42!';
      const identifier =
        identifierType === 'EMAIL'
          ? `closure-${unique}@example.test`
          : `+63917${randomInt(1000000, 10000000)}`;
      const mobile = app
        .get(MobileNumberService)
        .protect(identifierType === 'MOBILE' ? identifier : '+639171234567');
      const owner = await prisma.user.create({
        data: {
          firstName: 'Closure',
          lastName: 'Owner',
          role: 'SECRETARY',
          loginIdentifierType: identifierType,
          email: identifierType === 'EMAIL' ? identifier : null,
          emailVerifiedAt: identifierType === 'EMAIL' ? new Date() : null,
          mobileVerifiedAt: identifierType === 'MOBILE' ? new Date() : null,
          mobileNumberHash: identifierType === 'MOBILE' ? mobile.hash : null,
          mobileNumber: identifierType === 'MOBILE' ? identifier : null,
          passwordHash: await bcrypt.hash(password, 12),
        },
      });
      const other = await prisma.user.create({
        data: {
          firstName: 'Other',
          lastName: 'Secretary',
          role: 'SECRETARY',
          email: `other-${unique}@example.test`,
          emailVerifiedAt: new Date(),
          passwordHash: owner.passwordHash,
        },
      });
      const doctor = await prisma.user.create({
        data: {
          firstName: 'History',
          lastName: 'Doctor',
          role: 'DOCTOR',
          email: `doctor-${unique}@example.test`,
          emailVerifiedAt: new Date(),
          passwordHash: owner.passwordHash,
          doctorProfile: {
            create: {
              professionalTitle: 'Dr.',
              specialization: 'General',
              licenseNumber: unique,
            },
          },
        },
        include: { doctorProfile: true },
      });
      const location = await prisma.practiceLocation.create({
        data: {
          doctorProfileId: doctor.doctorProfile!.id,
          name: 'Preserved clinic',
          addressLine1: 'Test street',
          cityMunicipality: 'Manila',
          province: 'Metro Manila',
          contactNumber: '+63280000001',
        },
      });
      const staff = await prisma.practiceStaff.create({
        data: { userId: owner.id, practiceLocationId: location.id },
      });
      const otherStaff = await prisma.practiceStaff.create({
        data: { userId: other.id, practiceLocationId: location.id },
      });
      await prisma.practiceLocation.update({
        where: { id: location.id },
        data: { currentRegularPracticeStaffId: staff.id },
      });
      const capability = await prisma.practiceStaffCapability.create({
        data: {
          practiceStaffId: staff.id,
          capabilityType: 'CANCEL_CLINIC_DAY',
          grantedByUserId: doctor.id,
          grantedAt: new Date(),
          activeCapabilityKey: randomUUID(),
        },
      });
      const otherCapability = await prisma.practiceStaffCapability.create({
        data: {
          practiceStaffId: otherStaff.id,
          capabilityType: 'CANCEL_CLINIC_DAY',
          grantedByUserId: doctor.id,
          grantedAt: new Date(),
          activeCapabilityKey: randomUUID(),
        },
      });
      const day = await prisma.clinicDay.create({
        data: {
          practiceLocationId: location.id,
          serviceDate: new Date('2026-09-10'),
          status: 'STARTED',
          createdAt: new Date(Date.now() - 1000),
          startedAt: new Date(),
          operatingPracticeStaffId: staff.id,
        },
      });
      const otherDay = await prisma.clinicDay.create({
        data: {
          practiceLocationId: location.id,
          serviceDate: new Date('2026-09-11'),
          operatingPracticeStaffId: otherStaff.id,
        },
      });
      const appointment = await prisma.appointment.create({
        data: {
          practiceLocationId: location.id,
          bookingReference: unique,
          serviceDate: day.serviceDate,
          estimatedServiceMinutes: 15,
          queueNumber: 7,
          createdByUserId: owner.id,
          servingOrderKey: 7,
          waitingPlacementType: 'ORDINARY',
        },
      });
      const browser = request.agent(app.getHttpServer());
      await browser
        .post('/auth/login')
        .set('Origin', 'https://app.example.test')
        .send({ identifier, password })
        .expect(201);
      const command = { identifier, password, confirmPermanentDelete: true };
      const close = (body = command) =>
        browser
          .post('/secretary/account/permanent-delete')
          .set('Origin', 'https://app.example.test')
          .set('Idempotency-Key', unique)
          .send(body);
      await request(app.getHttpServer())
        .post('/secretary/account/permanent-delete')
        .set('Idempotency-Key', unique)
        .send(command)
        .expect(401);
      await browser
        .post('/secretary/account/permanent-delete')
        .set('Idempotency-Key', unique)
        .send(command)
        .expect(403);
      await close({ ...command, password: 'incorrect' }).expect(401);
      await close({ ...command, identifier: other.email! }).expect(401);
      const otherBrowser = request.agent(app.getHttpServer());
      await otherBrowser
        .post('/auth/login')
        .set('Origin', 'https://app.example.test')
        .send({ identifier: other.email, password })
        .expect(201);
      await otherBrowser
        .post('/secretary/account/permanent-delete')
        .set('Origin', 'https://app.example.test')
        .set('Idempotency-Key', unique)
        .send(command)
        .expect(401);
      const doctorBrowser = request.agent(app.getHttpServer());
      await doctorBrowser
        .post('/auth/login')
        .set('Origin', 'https://app.example.test')
        .send({ identifier: doctor.email, password })
        .expect(201);
      await doctorBrowser
        .post('/secretary/account/permanent-delete')
        .set('Origin', 'https://app.example.test')
        .set('Idempotency-Key', unique)
        .send(command)
        .expect(401);

      // Inject failure into the durable audit write inside a real database transaction.
      const actualTransaction = prisma.$transaction.bind(prisma) as (
        callback: (tx: Prisma.TransactionClient) => Promise<unknown>,
      ) => Promise<unknown>;
      const transactionSpy = jest
        .spyOn(prisma, '$transaction')
        .mockImplementationOnce(
          (callback: (tx: Prisma.TransactionClient) => Promise<unknown>) =>
            actualTransaction(async (tx) => {
              tx.accountPermanentClosureAudit.create = jest
                .fn()
                .mockRejectedValue(new Error('Injected closure audit failure'));
              return callback(tx);
            }),
        );
      try {
        await expect(
          app
            .get(SecretaryLifecycleService)
            .permanentlyDelete(owner.id, identifier, password, true, unique),
        ).rejects.toThrow('Injected closure audit failure');
      } finally {
        transactionSpy.mockRestore();
      }
      expect(
        (await prisma.user.findUniqueOrThrow({ where: { id: owner.id } }))
          .accountStatus,
      ).toBe('ACTIVE');
      expect(
        await prisma.userSession.count({
          where: { userId: owner.id, revokedAt: null },
        }),
      ).toBe(1);
      expect(
        await prisma.accountPermanentClosureAudit.count({
          where: { accountUserId: owner.id },
        }),
      ).toBe(0);
      expect(
        await prisma.commandIdempotency.count({
          where: { accountUserId: owner.id },
        }),
      ).toBe(0);
      expect(
        await prisma.clinicDayOperatingStaffAudit.count({
          where: { clinicDayId: day.id },
        }),
      ).toBe(0);
      expect(
        (
          await prisma.practiceStaff.findUniqueOrThrow({
            where: { id: staff.id },
          })
        ).isActive,
      ).toBe(true);
      expect(
        (
          await prisma.practiceStaffCapability.findUniqueOrThrow({
            where: { id: capability.id },
          })
        ).status,
      ).toBe('ACTIVE');
      expect(
        (await prisma.clinicDay.findUniqueOrThrow({ where: { id: day.id } }))
          .operatingPracticeStaffId,
      ).toBe(staff.id);
      expect(
        (
          await prisma.practiceLocation.findUniqueOrThrow({
            where: { id: location.id },
          })
        ).currentRegularPracticeStaffId,
      ).toBe(staff.id);
      await browser.get('/auth/profile').expect(200);

      await close()
        .expect(201)
        .expect({ permanentlyClosed: true, replayed: false });
      await close().expect(401);
      await expect(
        app
          .get(SecretaryLifecycleService)
          .permanentlyDelete(owner.id, identifier, password, true, unique),
      ).resolves.toEqual({ permanentlyClosed: true, replayed: true });
      expect(
        await prisma.accountPermanentClosureAudit.count({
          where: { accountUserId: owner.id },
        }),
      ).toBe(1);
      expect(
        await prisma.userSession.count({
          where: { userId: owner.id, revokedAt: null },
        }),
      ).toBe(0);
      expect(
        (await prisma.user.findUniqueOrThrow({ where: { id: owner.id } }))
          .accountStatus,
      ).toBe('PERMANENTLY_CLOSED');
      expect(
        (
          await prisma.practiceStaff.findUniqueOrThrow({
            where: { id: staff.id },
          })
        ).isActive,
      ).toBe(false);
      expect(
        (
          await prisma.practiceStaffCapability.findUniqueOrThrow({
            where: { id: capability.id },
          })
        ).status,
      ).toBe('REVOKED');
      expect(
        await prisma.clinicDay.findUniqueOrThrow({ where: { id: day.id } }),
      ).toEqual(
        expect.objectContaining({
          status: 'STARTED',
          operatingPracticeStaffId: null,
          closedAt: null,
          cancelledAt: null,
        }),
      );
      expect(
        await prisma.clinicDayOperatingStaffAudit.count({
          where: { clinicDayId: day.id },
        }),
      ).toBe(1);
      expect(
        (
          await prisma.practiceLocation.findUniqueOrThrow({
            where: { id: location.id },
          })
        ).currentRegularPracticeStaffId,
      ).toBeNull();
      expect(
        await prisma.practiceStaff.findUniqueOrThrow({
          where: { id: otherStaff.id },
        }),
      ).toEqual(otherStaff);
      expect(
        await prisma.practiceStaffCapability.findUniqueOrThrow({
          where: { id: otherCapability.id },
        }),
      ).toEqual(otherCapability);
      expect(
        await prisma.clinicDay.findUniqueOrThrow({
          where: { id: otherDay.id },
        }),
      ).toEqual(otherDay);
      expect(
        await prisma.appointment.findUniqueOrThrow({
          where: { id: appointment.id },
        }),
      ).toEqual(appointment);
      expect(
        await prisma.doctorProfile.findUniqueOrThrow({
          where: { id: doctor.doctorProfile!.id },
        }),
      ).toEqual(doctor.doctorProfile);
      await browser.get('/auth/profile').expect(401);
      await request(app.getHttpServer())
        .post('/auth/login')
        .set('Origin', 'https://app.example.test')
        .send({ identifier, password })
        .expect(401)
        .expect((response) =>
          expect((response.body as { message: string }).message).toBe(
            'Invalid login details or password.',
          ),
        );

      // Race two normal registrations after closure. Exactly one new current
      // account may claim the normalized identifier, even with retained history.
      const variants =
        identifierType === 'EMAIL'
          ? [identifier, identifier.toUpperCase()]
          : [identifier, `0${identifier.slice(3)}`];
      const passwords = [
        'Returning-Secretary-New-42!',
        'Returning-Secretary-Other-42!',
      ];
      const registrations = await Promise.all(
        variants.map((value, index) =>
          request(app!.getHttpServer()).post('/auth/register').send({
            firstName: 'Returning',
            lastName: 'New account',
            role: 'SECRETARY',
            identifier: value,
            password: passwords[index],
          }),
        ),
      );
      expect(registrations.map((result) => result.status).sort()).toEqual([
        201, 409,
      ]);
      const winner = registrations.findIndex((result) => result.status === 201);
      const registration = registrations[winner].body as {
        userId: string;
        verificationRequired: boolean;
        verificationChannel: string;
        registrationStatus: string;
      };
      const newUserId = registration.userId;
      const newPassword = passwords[winner];
      expect(newUserId).not.toBe(owner.id);
      expect(registration).toEqual(
        expect.objectContaining({
          registrationStatus: 'CREATED',
          verificationRequired: true,
          verificationChannel: identifierType,
        }),
      );
      const newAccount = await prisma.user.findUniqueOrThrow({
        where: { id: newUserId },
      });
      expect(newAccount.accountStatus).toBe('ACTIVE');
      expect(newAccount.emailVerifiedAt).toBeNull();
      expect(newAccount.mobileVerifiedAt).toBeNull();
      expect(newAccount.lastLoginAt).toBeNull();
      if (identifierType === 'MOBILE') {
        expect(newAccount.email).toBeNull();
        expect(newAccount.mobileNumberHash).toBe(owner.mobileNumberHash);
      }
      expect(
        await prisma.userSession.count({ where: { userId: newUserId } }),
      ).toBe(0);
      expect(
        await prisma.practiceStaff.count({ where: { userId: newUserId } }),
      ).toBe(0);
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ identifier, password: newPassword })
        .expect(401);
      await verifyNewAccount(newUserId, identifierType);
      const newBrowser = request.agent(app.getHttpServer());
      await newBrowser
        .post('/auth/login')
        .send({ identifier, password: newPassword })
        .expect(201);
      await newBrowser
        .get('/auth/profile')
        .expect(200)
        .expect({ userId: newUserId, role: 'SECRETARY' });
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ identifier, password })
        .expect(401);
      await browser.get('/auth/profile').expect(401);
      expect(
        await prisma.user.findUniqueOrThrow({ where: { id: owner.id } }),
      ).toEqual(
        expect.objectContaining({
          accountStatus: 'PERMANENTLY_CLOSED',
          email: owner.email,
          mobileNumberHash: owner.mobileNumberHash,
        }),
      );
      expect(
        await prisma.accountPermanentClosureAudit.count({
          where: { accountUserId: owner.id },
        }),
      ).toBe(1);
      expect(
        await prisma.accountPermanentClosureAudit.count({
          where: { accountUserId: newUserId },
        }),
      ).toBe(0);
      expect(
        await prisma.appointment.findUniqueOrThrow({
          where: { id: appointment.id },
        }),
      ).toEqual(appointment);
      expect(
        (
          await prisma.practiceStaff.findUniqueOrThrow({
            where: { id: staff.id },
          })
        ).userId,
      ).toBe(owner.id);
      await expect(
        app
          .get(SecretaryLifecycleService)
          .permanentlyDelete(owner.id, identifier, password, true, unique),
      ).resolves.toEqual({ permanentlyClosed: true, replayed: true });
      await newBrowser.get('/auth/profile').expect(200);

      // Temporary disablement still reserves the identifier for reactivation.
      await newBrowser
        .post('/secretary/account/disable')
        .set('Origin', 'https://app.example.test')
        .set('Idempotency-Key', randomUUID())
        .send({ currentPassword: newPassword })
        .expect(201);
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          firstName: 'Duplicate',
          lastName: 'Disabled',
          role: 'SECRETARY',
          identifier,
          password: 'Another-account-password-42!',
        })
        .expect(409);
      await request(app.getHttpServer())
        .post('/secretary/account/reactivate')
        .set('Idempotency-Key', randomUUID())
        .send({ identifier, password: newPassword })
        .expect(201);
      await newBrowser
        .post('/auth/login')
        .set('Origin', 'https://app.example.test')
        .send({ identifier, password: newPassword })
        .expect(201);
      await newBrowser
        .post('/secretary/account/permanent-delete')
        .set('Origin', 'https://app.example.test')
        .set('Idempotency-Key', randomUUID())
        .send({
          identifier,
          password: newPassword,
          confirmPermanentDelete: true,
        })
        .expect(201);
      const thirdRegistration = await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          firstName: 'Third',
          lastName: 'New account',
          role: 'SECRETARY',
          identifier,
          password: 'Third-account-password-42!',
        })
        .expect(201);
      const thirdUserId = (thirdRegistration.body as { userId: string }).userId;
      expect([owner.id, newUserId]).not.toContain(thirdUserId);
      expect(
        await prisma.user.count({
          where:
            identifierType === 'EMAIL'
              ? { email: identifier }
              : { mobileNumberHash: owner.mobileNumberHash },
        }),
      ).toBe(3);
    },
  );

  it('requires a disabled mobile Secretary to reactivate and sign in before closure', async () => {
    if (!app) throw new Error('E2E application did not initialize.');
    const identifier = `+63918${randomInt(1000000, 10000000)}`;
    const password = 'Disabled-mobile-secretary-42!';
    const owner = await prisma.user.create({
      data: {
        firstName: 'Disabled',
        lastName: 'Mobile',
        role: 'SECRETARY',
        loginIdentifierType: 'MOBILE',
        mobileNumber: identifier,
        mobileNumberHash: app.get(MobileNumberService).protect(identifier).hash,
        mobileVerifiedAt: new Date(),
        passwordHash: await bcrypt.hash(password, 12),
      },
    });
    const browser = request.agent(app.getHttpServer());
    await browser
      .post('/auth/login')
      .set('Origin', 'https://app.example.test')
      .send({ identifier, password })
      .expect(201);
    await browser
      .post('/secretary/account/disable')
      .set('Origin', 'https://app.example.test')
      .set('Idempotency-Key', randomUUID())
      .send({ currentPassword: password })
      .expect(201);
    const close = () =>
      browser
        .post('/secretary/account/permanent-delete')
        .set('Origin', 'https://app.example.test')
        .set('Idempotency-Key', randomUUID())
        .send({ identifier, password, confirmPermanentDelete: true });
    await close().expect(401);
    await browser
      .post('/auth/login')
      .set('Origin', 'https://app.example.test')
      .send({ identifier, password })
      .expect(401);
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: owner.id } }))
        .accountStatus,
    ).toBe('VOLUNTARILY_DISABLED');
    await request(app.getHttpServer())
      .post('/secretary/account/reactivate')
      .set('Idempotency-Key', randomUUID())
      .send({ identifier, password })
      .expect(201);
    await close().expect(401);
    await browser
      .post('/auth/login')
      .set('Origin', 'https://app.example.test')
      .send({ identifier, password })
      .expect(201);
    await close().expect(201);
    expect(
      await prisma.accountPermanentClosureAudit.count({
        where: { accountUserId: owner.id },
      }),
    ).toBe(1);
  });

  it('requires irreversible confirmation and password, revokes access permanently, audits closure, and permits a fresh later identity', async () => {
    if (!app) throw new Error('E2E application did not initialize.');

    const unique = randomUUID();
    const email = `secretary-close-${unique}@example.test`;
    const password = 'R1-Secretary-Close-Password-42!';

    const registration = await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        firstName: 'Maria',
        lastName: 'Closure',
        identifier: email,
        password,
        role: 'SECRETARY',
      })
      .expect(201);
    const registrationBody = registration.body as unknown as { userId: string };
    const originalUserId = registrationBody.userId;

    const verification = await prisma.emailVerification.findFirstOrThrow({
      where: { userId: originalUserId, status: 'PENDING' },
      include: { notificationOutbox: true },
      orderBy: { createdAt: 'desc' },
    });
    const encryptedMessage =
      verification.notificationOutbox?.messageBodyEncrypted;
    if (!encryptedMessage) throw new Error('Verification message is missing.');

    const message = protectedPayloadService.decrypt(
      encryptedMessage,
      'doctor-email-verification:message',
    );
    const verificationUrl = message.match(/https:\/\/\S+/)?.[0];
    const token = verificationUrl
      ? new URL(verificationUrl).searchParams.get('token')
      : null;
    if (!token) throw new Error('Verification token is missing.');

    await request(app.getHttpServer())
      .post('/auth/verify-email')
      .send({ token })
      .expect(201);

    const browser = request.agent(app.getHttpServer());
    await browser
      .post('/auth/login')
      .set('Origin', 'https://app.example.test')
      .send({ identifier: email, password })
      .expect(201);
    await browser.get('/auth/profile').expect(200);

    await browser
      .post('/secretary/account/permanent-delete')
      .set('Origin', 'https://app.example.test')
      .set('Idempotency-Key', `close-unconfirmed-${unique}`)
      .send({ identifier: email, password, confirmPermanentDelete: false })
      .expect(400);

    await browser
      .post('/secretary/account/permanent-delete')
      .set('Origin', 'https://app.example.test')
      .set('Idempotency-Key', `close-wrong-password-${unique}`)
      .send({
        identifier: email,
        password: 'Wrong-Password-42!',
        confirmPermanentDelete: true,
      })
      .expect(401);

    const beforeClosure = await prisma.user.findUniqueOrThrow({
      where: { id: originalUserId },
    });
    expect(beforeClosure.accountStatus).toBe('ACTIVE');

    const closure = await browser
      .post('/secretary/account/permanent-delete')
      .set('Origin', 'https://app.example.test')
      .set('Idempotency-Key', `close-${unique}`)
      .send({ identifier: email, password, confirmPermanentDelete: true })
      .expect(201);
    expect(closure.body).toEqual({ permanentlyClosed: true, replayed: false });

    const closedUser = await prisma.user.findUniqueOrThrow({
      where: { id: originalUserId },
    });
    expect(closedUser.accountStatus).toBe('PERMANENTLY_CLOSED');
    expect(
      await prisma.userSession.count({
        where: { userId: originalUserId, revokedAt: null },
      }),
    ).toBe(0);
    expect(
      await prisma.accountPermanentClosureAudit.count({
        where: { accountUserId: originalUserId },
      }),
    ).toBe(1);
    expect(
      await prisma.practiceStaff.count({
        where: { userId: originalUserId, isActive: true },
      }),
    ).toBe(0);

    await browser.get('/auth/profile').expect(401);
    await request(app.getHttpServer())
      .post('/auth/login')
      .set('Origin', 'https://app.example.test')
      .send({ identifier: email, password })
      .expect(401);
    await request(app.getHttpServer())
      .post('/secretary/account/reactivate')
      .set('Idempotency-Key', `reactivate-closed-${unique}`)
      .send({ identifier: email, password })
      .expect(401);

    const replay = await browser
      .post('/secretary/account/permanent-delete')
      .set('Origin', 'https://app.example.test')
      .set('Idempotency-Key', `close-${unique}`)
      .send({ identifier: email, password, confirmPermanentDelete: true })
      .expect(401);
    expect(replay.body).toEqual(expect.objectContaining({ statusCode: 401 }));
    expect(
      await prisma.accountPermanentClosureAudit.count({
        where: { accountUserId: originalUserId },
      }),
    ).toBe(1);

    const replacementRegistration = await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        firstName: 'Maria',
        lastName: 'Returning',
        identifier: email.toUpperCase(),
        password: 'R1-New-Secretary-Identity-42!',
        role: 'SECRETARY',
      })
      .expect(201);
    const replacementBody = replacementRegistration.body as unknown as {
      userId: string;
      role: 'SECRETARY';
    };

    expect(replacementBody.userId).not.toBe(originalUserId);
    expect(replacementBody.role).toBe('SECRETARY');
    expect(
      await prisma.user.count({
        where: { email: email.toLowerCase() },
      }),
    ).toBe(2);
  });
});
