import { createHash, randomUUID } from 'crypto';
import {
  BookingGroupAccessTokenPurpose,
  PracticeLocationLifecycleStatus,
} from './../generated/prisma/client';
import { PatientBookingGroupAccessService } from './../src/patient-access/patient-booking-group-access.service';
import { PrismaService } from './../src/prisma/prisma.service';

describe('Patient BookingGroup controller access (e2e)', () => {
  let prisma: PrismaService;
  let service: PatientBookingGroupAccessService;
  let practiceLocationId: string;
  let scope: string;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    service = new PatientBookingGroupAccessService(prisma);

    scope = randomUUID().replaceAll('-', '');
    const doctor = await prisma.user.create({
      data: {
        email: `m8-group-access-${scope.slice(0, 12)}@example.test`,
        firstName: 'Group',
        lastName: 'Access',
        mobileNumber: `0960${scope.slice(0, 7)}`,
        passwordHash: 'e2e-only-not-a-real-password-hash',
        role: 'DOCTOR',
        accountStatus: 'ACTIVE',
        administrativeRestrictionStatus: 'NONE',
        emailVerifiedAt: new Date(),
      },
    });
    const profile = await prisma.doctorProfile.create({
      data: {
        userId: doctor.id,
        professionalTitle: 'Dr.',
        specialization: 'Group Access',
        licenseNumber: `M8GA-${scope.slice(0, 12)}`,
      },
    });
    const location = await prisma.practiceLocation.create({
      data: {
        doctorProfileId: profile.id,
        lifecycleStatus: PracticeLocationLifecycleStatus.ACTIVE,
        name: `M8 Group Access ${scope.slice(0, 8)}`,
        countryCode: 'PH',
        timeZone: 'Asia/Manila',
      },
    });
    practiceLocationId = location.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('authorizes exactly one BookingGroup, reloads current members, and updates lastUsedAt', async () => {
    const fixture = await createGroupFixture();

    const access = await service.establish(fixture.rawToken, fixture.groupId);

    expect(access.bookingGroup.id).toBe(fixture.groupId);
    expect(access.bookingGroup.members).toHaveLength(2);
    expect(access.bookingGroup.members.map((member) => member.queueNumber)).toEqual(
      fixture.queueNumbers,
    );

    const storedToken = await prisma.bookingGroupAccessToken.findUniqueOrThrow({
      where: { id: fixture.tokenId },
    });
    expect(storedToken.lastUsedAt).not.toBeNull();
  });

  it('rejects a valid token when it is presented for another BookingGroup', async () => {
    const first = await createGroupFixture();
    const second = await createGroupFixture();

    await expect(
      service.establish(first.rawToken, second.groupId),
    ).rejects.toMatchObject({ status: 401 });
  });

  it('rejects revoked and expired group credentials without updating lastUsedAt', async () => {
    const revoked = await createGroupFixture();
    await prisma.bookingGroupAccessToken.update({
      where: { id: revoked.tokenId },
      data: { revokedAt: new Date() },
    });

    await expect(
      service.establish(revoked.rawToken, revoked.groupId),
    ).rejects.toMatchObject({ status: 401 });

    const expired = await createGroupFixture({ expired: true });
    await expect(
      service.establish(expired.rawToken, expired.groupId),
    ).rejects.toMatchObject({ status: 401 });

    const [revokedStored, expiredStored] = await Promise.all([
      prisma.bookingGroupAccessToken.findUniqueOrThrow({
        where: { id: revoked.tokenId },
      }),
      prisma.bookingGroupAccessToken.findUniqueOrThrow({
        where: { id: expired.tokenId },
      }),
    ]);
    expect(revokedStored.lastUsedAt).toBeNull();
    expect(expiredStored.lastUsedAt).toBeNull();
  });

  it('does not expose anonymized member identity and rejects when no identifiable member remains', async () => {
    const fixture = await createGroupFixture();
    const appointments = await prisma.appointment.findMany({
      where: { bookingGroupId: fixture.groupId },
      orderBy: { queueNumber: 'asc' },
    });

    await prisma.appointment.update({
      where: { id: appointments[0]!.id },
      data: { anonymizedAt: new Date() },
    });

    const partial = await service.establish(fixture.rawToken, fixture.groupId);
    expect(partial.bookingGroup.members).toHaveLength(1);
    expect(partial.bookingGroup.members[0]?.queueNumber).toBe(
      fixture.queueNumbers[1],
    );

    await prisma.appointment.update({
      where: { id: appointments[1]!.id },
      data: { anonymizedAt: new Date() },
    });

    await expect(
      service.establish(fixture.rawToken, fixture.groupId),
    ).rejects.toMatchObject({ status: 401 });
  });

  async function createGroupFixture(options?: { expired?: boolean }) {
    const serviceDate = new Date('2026-10-15T00:00:00.000Z');
    const existingCount = await prisma.appointment.count({
      where: { practiceLocationId, serviceDate },
    });
    const queueNumbers = [existingCount + 1, existingCount + 2];

    const group = await prisma.bookingGroup.create({
      data: {
        practiceLocationId,
        serviceDate,
        controllingMobileNumberEncrypted: `enc-${randomUUID()}`,
        controllingMobileNumberHash: createHash('sha256')
          .update(randomUUID())
          .digest('hex'),
        controllingMobileLastFour: '1234',
      },
    });

    await prisma.appointment.createMany({
      data: [
        {
          bookingReference: `M8GA-${randomUUID()}`,
          practiceLocationId,
          bookingGroupId: group.id,
          serviceDate,
          estimatedServiceMinutes: 15,
          queueNumber: queueNumbers[0],
          status: 'WAITING',
          firstName: 'Alpha',
          lastName: 'Member',
          activeAppointmentKey: randomUUID(),
        },
        {
          bookingReference: `M8GA-${randomUUID()}`,
          practiceLocationId,
          bookingGroupId: group.id,
          serviceDate,
          estimatedServiceMinutes: 15,
          queueNumber: queueNumbers[1],
          status: 'WAITING',
          firstName: 'Beta',
          lastName: 'Member',
          activeAppointmentKey: randomUUID(),
        },
      ],
    });

    const rawToken =
      randomUUID().replaceAll('-', '') + randomUUID().replaceAll('-', '');
    const tokenHash = createHash('sha256')
      .update(rawToken, 'utf8')
      .digest('hex');
    const now = new Date();
    const createdAt = options?.expired
      ? new Date(now.getTime() - 2 * 60 * 60 * 1000)
      : now;
    const expiresAt = options?.expired
      ? new Date(now.getTime() - 60 * 60 * 1000)
      : new Date(serviceDate.getTime() + 7 * 24 * 60 * 60 * 1000);

    const token = await prisma.bookingGroupAccessToken.create({
      data: {
        bookingGroupId: group.id,
        tokenHash,
        purpose: BookingGroupAccessTokenPurpose.CONTROLLER_ACCESS,
        createdAt,
        expiresAt,
      },
    });

    return {
      groupId: group.id,
      rawToken,
      tokenId: token.id,
      queueNumbers,
    };
  }
});
