import { randomUUID } from 'crypto';
import { PrismaService } from '../src/prisma/prisma.service';
import { PasswordSecurityService } from '../src/auth/security/password-security.service';
import { SessionManagementService } from '../src/auth/session-management.service';
import { DoctorAccountDataService } from '../src/doctor/doctor-account-data.service';
import { DoctorAuditService } from '../src/doctor/doctor-audit.service';
import { UserRole } from '../generated/prisma/client';

describe('Settings security, notifications, and account-only downloads (isolated database)', () => {
  const prisma = new PrismaService();
  const passwords = new PasswordSecurityService();
  const sessions = new SessionManagementService(prisma, passwords);
  const data = new DoctorAccountDataService(prisma, sessions, passwords);
  const audit = new DoctorAuditService(prisma, sessions);
  const ids: string[] = [];
  const password = 'A carefully chosen test passphrase';
  beforeAll(async () => {
    await prisma.$connect();
  });
  afterAll(async () => {
    const clinics = await prisma.practiceLocation.findMany({
      where: { doctorProfile: { userId: { in: ids } } },
      select: { id: true },
    });
    await prisma.applicationNotification.deleteMany({
      where: { recipientUserId: { in: ids } },
    });
    await prisma.secretaryInvitation.deleteMany({
      where: { practiceLocationId: { in: clinics.map((clinic) => clinic.id) } },
    });
    await prisma.subscriptionPayment.deleteMany({
      where: { subscriptionPurchase: { purchasedByUserId: { in: ids } } },
    });
    await prisma.subscriptionPurchase.deleteMany({
      where: { purchasedByUserId: { in: ids } },
    });
    await prisma.doctorFinancialAccount.deleteMany({
      where: { doctorUserId: { in: ids } },
    });
    await prisma.practiceLocation.deleteMany({
      where: { id: { in: clinics.map((clinic) => clinic.id) } },
    });
    await prisma.doctorAccountSettings.deleteMany({
      where: { doctorProfile: { userId: { in: ids } } },
    });
    await prisma.doctorProfile.deleteMany({ where: { userId: { in: ids } } });
    await prisma.userSession.deleteMany({ where: { userId: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
    await prisma.$disconnect();
  });
  async function fixture() {
    const id = randomUUID();
    ids.push(id);
    const user = await prisma.user.create({
      data: {
        id,
        email: `${id}@example.test`,
        firstName: 'Settings',
        lastName: 'Test',
        mobileNumber: '+639171234567',
        role: 'DOCTOR',
        emailVerifiedAt: new Date(),
        passwordHash: await passwords.hashStrong(password),
      },
    });
    const profile = await prisma.doctorProfile.create({
      data: {
        userId: id,
        professionalTitle: 'Dr.',
        specialization: 'Test',
        licenseNumber: id,
      },
    });
    await prisma.doctorAccountSettings.create({
      data: { doctorProfileId: profile.id },
    });
    const clinic = await prisma.practiceLocation.create({
      data: {
        doctorProfileId: profile.id,
        name: 'Private Test Clinic',
        countryCode: 'PH',
        timeZone: 'Asia/Manila',
      },
    });
    const session = await prisma.userSession.create({
      data: {
        userId: id,
        tokenHash: randomUUID().replaceAll('-', '').padEnd(64, '0'),
        lastSeenAt: new Date(),
        expiresAt: new Date(Date.now() + 3600000),
        idleExpiresAt: new Date(Date.now() + 3600000),
      },
    });
    return {
      user,
      clinic,
      actor: { userId: id, sessionId: session.id, role: UserRole.DOCTOR },
    };
  }
  it('reads the actual audit SQL and exports only the calling account', async () => {
    const owner = await fixture();
    const other = await fixture();
    const result = await data.export(owner.actor, password, false);
    expect(result.account?.id).toBe(owner.user.id);
    expect(JSON.stringify(result)).not.toContain(other.user.email);
    expect(JSON.stringify(result)).not.toContain('passwordHash');
    expect(JSON.stringify(result)).not.toContain('Private Test Clinic');
    const timeline = await audit.list(
      owner.actor,
      '2026-01-01',
      '2026-12-31',
      1,
    );
    expect(timeline.total).toBe(0);
  });
  it('creates scoped invitation notices and does not duplicate unchanged status updates', async () => {
    const owner = await fixture();
    const invitation = await prisma.secretaryInvitation.create({
      data: {
        practiceLocationId: owner.clinic.id,
        invitedByUserId: owner.user.id,
        normalizedEmail: 'invitee@example.test',
        firstName: 'Invited',
        lastName: 'Secretary',
        mobileNumber: '+639171234567',
        tokenHash: randomUUID().padEnd(64, '0'),
        activeInvitationKey: randomUUID().padEnd(64, '0'),
        expiresAt: new Date(Date.now() + 86400000),
      },
    });
    await prisma.secretaryInvitation.update({
      where: { id: invitation.id },
      data: {
        status: 'REVOKED',
        revokedAt: new Date(),
        activeInvitationKey: null,
      },
    });
    await prisma.secretaryInvitation.update({
      where: { id: invitation.id },
      data: { status: 'REVOKED' },
    });
    const notices = await prisma.applicationNotification.findMany({
      where: { recipientUserId: owner.user.id },
    });
    expect(notices.map((notice) => notice.title).sort()).toEqual([
      'Secretary invitation cancelled',
      'Secretary invitation sent',
    ]);
    expect(
      notices.every((notice) => notice.practiceLocationId === owner.clinic.id),
    ).toBe(true);
  });
  it('creates payment status notices for the financial account owner', async () => {
    const owner = await fixture();
    const financial = await prisma.doctorFinancialAccount.create({
      data: { doctorUserId: owner.user.id },
    });
    const purchase = await prisma.subscriptionPurchase.create({
      data: {
        doctorFinancialAccountId: financial.id,
        purchasedByUserId: owner.user.id,
        monthsPurchased: 1,
        monthlyPriceSnapshot: 100,
        grossAmount: 100,
        creditAmountApplied: 0,
        externalAmountRequired: 100,
        periodStart: new Date(),
        periodEnd: new Date(Date.now() + 30 * 86400000),
      },
    });
    const payment = await prisma.subscriptionPayment.create({
      data: {
        subscriptionPurchaseId: purchase.id,
        provider: 'isolated-test',
        providerPaymentReference: randomUUID(),
        amount: 100,
        createdAt: new Date(Date.now() - 1000),
        initiatedAt: new Date(),
      },
    });
    await prisma.subscriptionPayment.update({
      where: { id: payment.id },
      data: { status: 'SUCCEEDED', confirmedAt: new Date() },
    });
    expect(
      await prisma.applicationNotification.count({
        where: {
          recipientUserId: owner.user.id,
          title: 'Subscription payment succeeded',
        },
      }),
    ).toBe(1);
  });
  it('bad passwords leave credentials and sessions unchanged; success notifies and revokes sessions', async () => {
    const owner = await fixture();
    await expect(
      sessions.changePassword(
        owner.actor,
        'wrong',
        'A different carefully chosen passphrase',
        'A different carefully chosen passphrase',
      ),
    ).rejects.toThrow('incorrect');
    expect(
      (
        await prisma.userSession.findUniqueOrThrow({
          where: { id: owner.actor.sessionId },
        })
      ).revokedAt,
    ).toBeNull();
    expect(
      await prisma.applicationNotification.count({
        where: { recipientUserId: owner.user.id },
      }),
    ).toBe(0);
    await sessions.changePassword(
      owner.actor,
      password,
      'A different carefully chosen passphrase',
      'A different carefully chosen passphrase',
    );
    expect(
      (
        await prisma.userSession.findUniqueOrThrow({
          where: { id: owner.actor.sessionId },
        })
      ).revokedAt,
    ).not.toBeNull();
    expect(
      await prisma.applicationNotification.count({
        where: { recipientUserId: owner.user.id, title: 'Password changed' },
      }),
    ).toBe(1);
    await expect(
      data.export(
        owner.actor,
        'A different carefully chosen passphrase',
        false,
      ),
    ).rejects.toThrow('Authentication');
  });
});
