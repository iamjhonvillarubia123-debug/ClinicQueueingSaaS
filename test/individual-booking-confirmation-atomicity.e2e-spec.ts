import { randomUUID } from 'crypto';
import {
  AdministrativeRestrictionStatus,
  PracticeLocationLifecycleStatus,
  UserAccountStatus,
  UserRole,
  WaitingPlacementType,
} from './../generated/prisma/client';
import { PrismaService } from './../src/prisma/prisma.service';
import { QueueNumberAllocationService } from './../src/queue/queue-number-allocation.service';

describe('Individual booking confirmation atomicity (e2e)', () => {
  let prisma: PrismaService;
  let queueNumbers: QueueNumberAllocationService;
  let practiceLocationId: string;
  let scope: string;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    queueNumbers = new QueueNumberAllocationService();

    scope = randomUUID().replaceAll('-', '');
    const doctorUser = await prisma.user.create({
      data: {
        email: `m6s2-atomicity-${scope.slice(0, 12)}@example.test`,
        firstName: 'Atomicity',
        lastName: 'Doctor',
        mobileNumber: `0919${scope.slice(0, 7)}`,
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
        specialization: 'Atomicity Testing',
        licenseNumber: `M6A-${scope.slice(0, 12)}`,
      },
    });
    const location = await prisma.practiceLocation.create({
      data: {
        doctorProfileId: doctorProfile.id,
        lifecycleStatus: PracticeLocationLifecycleStatus.ACTIVE,
        name: `M6 Atomicity ${scope.slice(0, 8)}`,
        countryCode: 'PH',
        timeZone: 'Asia/Manila',
      },
    });
    practiceLocationId = location.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('rolls back QueueCounter and permanent booking artifacts when confirmation fails after queue allocation', async () => {
    const serviceDate = new Date('2026-08-24T00:00:00.000Z');
    const bookingReference = `M6A-${scope.slice(0, 8)}-ROLLBACK`;
    const activeAppointmentKey = `atomicity-${scope.slice(0, 24)}`;

    await expect(
      prisma.$transaction(async (transaction) => {
        const queueNumber = await queueNumbers.allocateNext(
          transaction,
          practiceLocationId,
          serviceDate,
        );

        const appointment = await transaction.appointment.create({
          data: {
            bookingReference,
            practiceLocationId,
            serviceDate,
            estimatedServiceMinutes: 30,
            queueNumber,
            servingOrderKey: queueNumber,
            waitingPlacementType: WaitingPlacementType.ORDINARY,
            firstName: 'Atomic',
            lastName: 'Rollback',
            activeAppointmentKey,
          },
          select: { id: true },
        });

        await transaction.contactPreference.create({
          data: {
            appointmentId: appointment.id,
            allowOperationalMessages: true,
            allowFollowUpReminder: false,
            allowMarketingMessages: false,
            acknowledgedAt: new Date('2026-08-17T00:00:00.000Z'),
            privacyNoticeVersion: 'e2e-test-v1',
          },
        });

        await transaction.bookingAccessToken.create({
          data: {
            appointmentId: appointment.id,
            tokenHash: `${scope.slice(0, 32)}${scope.slice(0, 32)}`,
            expiresAt: new Date('2026-08-31T00:00:00.000Z'),
          },
        });

        throw new Error('intentional confirmation rollback');
      }),
    ).rejects.toThrow('intentional confirmation rollback');

    const [counter, appointment, contactPreference, token] = await Promise.all([
      prisma.queueCounter.findUnique({
        where: {
          practiceLocationId_serviceDate: {
            practiceLocationId,
            serviceDate,
          },
        },
      }),
      prisma.appointment.findUnique({ where: { bookingReference } }),
      prisma.contactPreference.findFirst({
        where: { appointment: { bookingReference } },
      }),
      prisma.bookingAccessToken.findFirst({
        where: { appointment: { bookingReference } },
      }),
    ]);

    expect(counter).toBeNull();
    expect(appointment).toBeNull();
    expect(contactPreference).toBeNull();
    expect(token).toBeNull();
  });
});
