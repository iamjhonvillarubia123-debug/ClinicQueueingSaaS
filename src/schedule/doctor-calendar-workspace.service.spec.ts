import { AppointmentStatus } from '../../generated/prisma/client';
import { PasswordSecurityService } from '../auth/security/password-security.service';
import { NotificationPayloadService } from '../notification/notification-payload.service';
import { PrismaService } from '../prisma/prisma.service';
import { DoctorCalendarWorkspaceService } from './doctor-calendar-workspace.service';

describe('DoctorCalendarWorkspaceService consequences', () => {
  const transaction = {
    $executeRaw: jest.fn(),
    doctorCalendarRule: { findFirst: jest.fn(), create: jest.fn() },
    appointment: { findMany: jest.fn(), update: jest.fn() },
    queueEvent: { findFirst: jest.fn(), create: jest.fn() },
    queueEventAppointmentLink: { create: jest.fn() },
    notificationOutbox: { create: jest.fn() },
  };
  const prisma = {
    doctorProfile: { findUnique: jest.fn() },
    user: { findUnique: jest.fn() },
    appointment: { count: jest.fn(), findMany: jest.fn() },
    doctorCalendarRule: { update: jest.fn() },
    $transaction: jest.fn((callback: (client: typeof transaction) => unknown) =>
      callback(transaction),
    ),
  };
  const passwords = { verify: jest.fn() };
  const payload = { encryptMessage: jest.fn(() => 'encrypted-message') };
  const service = new DoctorCalendarWorkspaceService(
    prisma as unknown as PrismaService,
    passwords as unknown as PasswordSecurityService,
    payload as unknown as NotificationPayloadService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.doctorProfile.findUnique.mockResolvedValue({
      id: 'doctor-1',
      accountSettings: { defaultTimeZone: 'Asia/Manila' },
    });
  });

  it('reports active appointments grouped by clinic', async () => {
    prisma.appointment.findMany.mockResolvedValue([
      {
        id: 'appointment-1',
        bookingReference: 'REF-1',
        queueNumber: 1,
        firstName: 'Ana',
        lastName: 'Reyes',
        status: AppointmentStatus.WAITING,
        practiceLocation: { id: 'clinic-1', name: 'North Clinic' },
      },
    ]);
    const result = await service.impact('user-1', '2026-09-10');
    expect(result).toMatchObject({
      appointmentCount: 1,
      requiresPassword: true,
      clinics: [{ clinicId: 'clinic-1', appointmentCount: 1 }],
    });
  });

  it('revalidates, cancels, audits, notifies, and closes the date atomically', async () => {
    prisma.appointment.count.mockResolvedValue(1);
    prisma.user.findUnique.mockResolvedValue({ passwordHash: 'hash' });
    passwords.verify.mockResolvedValue(true);
    transaction.doctorCalendarRule.findFirst.mockResolvedValue(null);
    transaction.appointment.findMany.mockResolvedValue([
      {
        id: 'appointment-1',
        practiceLocationId: 'clinic-1',
        serviceDate: new Date('2026-09-10T00:00:00.000Z'),
        status: AppointmentStatus.WAITING,
        servingOrderKey: null,
        waitingPlacementType: null,
        terminalAt: null,
        mobileNumberEncrypted: 'encrypted-mobile',
        contactPreference: { allowOperationalMessages: true },
      },
    ]);
    transaction.queueEvent.findFirst.mockResolvedValue(null);
    transaction.queueEvent.create.mockResolvedValue({ id: 'event-1' });
    transaction.doctorCalendarRule.create.mockResolvedValue({
      id: 'rule-1',
      customLabel: null,
    });
    const result = await service.confirmUnavailable('user-1', {
      date: '2026-09-10',
      cancelAffectedAppointments: true,
      password: 'password',
    });
    expect(result.cancelledAppointmentCount).toBe(1);
    expect(transaction.appointment.update).toHaveBeenCalled();
    expect(transaction.queueEvent.create).toHaveBeenCalled();
    expect(transaction.notificationOutbox.create).toHaveBeenCalled();
    expect(transaction.doctorCalendarRule.create).toHaveBeenCalled();
  });
});
