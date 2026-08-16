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

describe('Queue Number allocation controls (e2e)', () => {
  let prisma: PrismaService;
  let allocator: QueueNumberAllocationService;
  let practiceLocationId: string;
  let scope: string;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    allocator = new QueueNumberAllocationService();

    scope = randomUUID().replaceAll('-', '');
    const doctorUser = await prisma.user.create({
      data: {
        email: `m6s1-doctor-${scope.slice(0, 12)}@example.test`,
        firstName: 'Queue',
        lastName: 'Doctor',
        mobileNumber: `0918${scope.slice(0, 7)}`,
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
        specialization: 'Queue Concurrency',
        licenseNumber: `M6Q-${scope.slice(0, 12)}`,
      },
    });
    const location = await prisma.practiceLocation.create({
      data: {
        doctorProfileId: doctorProfile.id,
        lifecycleStatus: PracticeLocationLifecycleStatus.ACTIVE,
        name: `M6 Queue ${scope.slice(0, 8)}`,
        countryCode: 'PH',
        timeZone: 'Asia/Manila',
      },
    });
    practiceLocationId = location.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('allocates 1 then 2 for successful Appointment creation in one location/date scope', async () => {
    const serviceDate = new Date('2026-08-20T00:00:00.000Z');

    const first = await createCommittedAppointment(serviceDate, 'A');
    const second = await createCommittedAppointment(serviceDate, 'B');

    expect(first).toBe(1);
    expect(second).toBe(2);

    const counter = await prisma.queueCounter.findUniqueOrThrow({
      where: {
        practiceLocationId_serviceDate: {
          practiceLocationId,
          serviceDate,
        },
      },
    });
    expect(counter.lastAllocatedNumber).toBe(2);
  });

  it('rolls back both the QueueCounter allocation and Appointment when creation fails', async () => {
    const serviceDate = new Date('2026-08-21T00:00:00.000Z');

    await expect(
      prisma.$transaction(async (transaction) => {
        const queueNumber = await allocator.allocateNext(
          transaction,
          practiceLocationId,
          serviceDate,
        );
        await transaction.appointment.create({
          data: {
            bookingReference: `M6Q-${scope.slice(0, 8)}-ROLLBACK`,
            practiceLocationId,
            serviceDate,
            estimatedServiceMinutes: 30,
            queueNumber,
            servingOrderKey: queueNumber,
            waitingPlacementType: WaitingPlacementType.ORDINARY,
            firstName: 'Rollback',
            lastName: 'Patient',
          },
        });
        throw new Error('intentional rollback');
      }),
    ).rejects.toThrow('intentional rollback');

    const [counter, appointment] = await Promise.all([
      prisma.queueCounter.findUnique({
        where: {
          practiceLocationId_serviceDate: {
            practiceLocationId,
            serviceDate,
          },
        },
      }),
      prisma.appointment.findUnique({
        where: { bookingReference: `M6Q-${scope.slice(0, 8)}-ROLLBACK` },
      }),
    ]);

    expect(counter).toBeNull();
    expect(appointment).toBeNull();
  });

  it('serializes concurrent first allocations into one counter with distinct Queue Numbers', async () => {
    const serviceDate = new Date('2026-08-22T00:00:00.000Z');

    const queueNumbers = await Promise.all([
      createCommittedAppointment(serviceDate, 'C'),
      createCommittedAppointment(serviceDate, 'D'),
    ]);

    expect([...queueNumbers].sort((a, b) => a - b)).toEqual([1, 2]);

    const [counter, appointments] = await Promise.all([
      prisma.queueCounter.findUniqueOrThrow({
        where: {
          practiceLocationId_serviceDate: {
            practiceLocationId,
            serviceDate,
          },
        },
      }),
      prisma.appointment.findMany({
        where: { practiceLocationId, serviceDate },
        select: { queueNumber: true },
      }),
    ]);

    expect(counter.lastAllocatedNumber).toBe(2);
    expect(
      appointments.map((item) => item.queueNumber).sort((a, b) => a - b),
    ).toEqual([1, 2]);
  });

  async function createCommittedAppointment(
    serviceDate: Date,
    discriminator: string,
  ): Promise<number> {
    return prisma.$transaction(async (transaction) => {
      const queueNumber = await allocator.allocateNext(
        transaction,
        practiceLocationId,
        serviceDate,
      );
      await transaction.appointment.create({
        data: {
          bookingReference: `M6Q-${scope.slice(0, 8)}-${serviceDate.toISOString().slice(8, 10)}-${discriminator}`,
          practiceLocationId,
          serviceDate,
          estimatedServiceMinutes: 30,
          queueNumber,
          servingOrderKey: queueNumber,
          waitingPlacementType: WaitingPlacementType.ORDINARY,
          firstName: 'Queue',
          lastName: `Patient${discriminator}`,
        },
      });
      return queueNumber;
    });
  }
});
