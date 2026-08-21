import { ConflictException } from '@nestjs/common';
import { AppointmentStatus } from '../../generated/prisma/client';
import { AppointmentErasureService } from './appointment-erasure.service';

describe('AppointmentErasureService', () => {
  const privacyErasureLedger = {
    findUnique: jest.fn(),
    create: jest.fn(),
  };
  const retentionHold = { findFirst: jest.fn() };
  const queueAnalyticsDaily = { upsert: jest.fn() };
  const bookingRecoveryAttempt = { updateMany: jest.fn() };
  const commandIdempotency = { updateMany: jest.fn() };
  const scheduledReminder = { updateMany: jest.fn() };
  const contactPreference = { updateMany: jest.fn() };
  const notificationOutbox = {
    findMany: jest.fn(),
    deleteMany: jest.fn(),
    updateMany: jest.fn(),
  };
  const notificationLog = { deleteMany: jest.fn() };
  const appointmentAnswer = { deleteMany: jest.fn() };
  const queueEventAppointmentLink = { deleteMany: jest.fn() };
  const bookingAccessToken = { deleteMany: jest.fn() };
  const bookingGroupRecoveryAttempt = { updateMany: jest.fn() };
  const bookingGroupAccessToken = { deleteMany: jest.fn() };
  const bookingGroup = { delete: jest.fn() };
  const appointment = {
    delete: jest.fn(),
    count: jest.fn(),
  };
  const transaction = {
    privacyErasureLedger,
    retentionHold,
    queueAnalyticsDaily,
    bookingRecoveryAttempt,
    commandIdempotency,
    scheduledReminder,
    contactPreference,
    notificationOutbox,
    notificationLog,
    appointmentAnswer,
    queueEventAppointmentLink,
    bookingAccessToken,
    bookingGroupRecoveryAttempt,
    bookingGroupAccessToken,
    bookingGroup,
    appointment,
    $queryRaw: jest.fn(),
  };
  const runTransaction = (
    callback: (client: typeof transaction) => unknown,
  ): unknown => callback(transaction);
  const prisma = { $transaction: jest.fn(runTransaction) };
  const service = new AppointmentErasureService(prisma as never);

  const now = new Date('2026-08-21T12:00:00.000Z');
  const terminalAt = new Date('2026-08-20T11:59:59.000Z');
  const serviceDate = new Date('2026-08-20T00:00:00.000Z');

  beforeEach(() => {
    jest.clearAllMocks();
    privacyErasureLedger.findUnique.mockResolvedValue(null);
    retentionHold.findFirst.mockResolvedValue(null);
    queueAnalyticsDaily.upsert.mockResolvedValue({ id: 'analytics-1' });
    privacyErasureLedger.create.mockResolvedValue({
      erasureCommittedAt: now,
    });
    notificationOutbox.findMany.mockResolvedValue([]);
    appointment.count.mockResolvedValue(0);
    appointment.delete.mockResolvedValue({ id: 'appointment-1' });
  });

  it('returns the committed ledger result without contributing analytics again', async () => {
    privacyErasureLedger.findUnique.mockResolvedValue({
      erasureCommittedAt: new Date('2026-08-21T10:00:00.000Z'),
    });

    await expect(
      service.eraseEligibleAppointment('appointment-1', now),
    ).resolves.toEqual({
      appointmentId: 'appointment-1',
      outcome: 'ALREADY_ERASED',
      erasureCommittedAt: new Date('2026-08-21T10:00:00.000Z'),
    });

    expect(transaction.$queryRaw).not.toHaveBeenCalled();
    expect(queueAnalyticsDaily.upsert).not.toHaveBeenCalled();
  });

  it('blocks erasure before terminalAt plus 24 hours', async () => {
    transaction.$queryRaw.mockResolvedValue([
      {
        id: 'appointment-1',
        practiceLocationId: 'location-1',
        bookingGroupId: null,
        serviceDate,
        status: AppointmentStatus.COMPLETED,
        terminalAt: new Date('2026-08-20T12:00:01.000Z'),
      },
    ]);

    await expect(
      service.eraseEligibleAppointment('appointment-1', now),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(queueAnalyticsDaily.upsert).not.toHaveBeenCalled();
    expect(privacyErasureLedger.create).not.toHaveBeenCalled();
    expect(appointment.delete).not.toHaveBeenCalled();
  });

  it('blocks erasure while an active retention hold exists', async () => {
    transaction.$queryRaw.mockResolvedValue([
      {
        id: 'appointment-1',
        practiceLocationId: 'location-1',
        bookingGroupId: null,
        serviceDate,
        status: AppointmentStatus.CANCELLED,
        terminalAt,
      },
    ]);
    retentionHold.findFirst.mockResolvedValue({ id: 'hold-1' });

    await expect(
      service.eraseEligibleAppointment('appointment-1', now),
    ).rejects.toThrow('Appointment is protected by an active retention hold.');

    expect(queueAnalyticsDaily.upsert).not.toHaveBeenCalled();
    expect(privacyErasureLedger.create).not.toHaveBeenCalled();
  });

  it('commits aggregate contribution, ledger and physical deletion once', async () => {
    transaction.$queryRaw.mockResolvedValue([
      {
        id: 'appointment-1',
        practiceLocationId: 'location-1',
        bookingGroupId: null,
        serviceDate,
        status: AppointmentStatus.COMPLETED,
        terminalAt,
      },
    ]);

    await expect(
      service.eraseEligibleAppointment('appointment-1', now),
    ).resolves.toEqual({
      appointmentId: 'appointment-1',
      outcome: 'ERASED',
      erasureCommittedAt: now,
    });

    expect(queueAnalyticsDaily.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          bookedCount: 1,
          servedCount: 1,
          cancelledCount: 0,
          absenceCount: 0,
        }) as Record<string, unknown>,
      }),
    );
    expect(privacyErasureLedger.create).toHaveBeenCalledTimes(1);
    expect(appointmentAnswer.deleteMany).toHaveBeenCalledWith({
      where: { appointmentId: 'appointment-1' },
    });
    expect(queueEventAppointmentLink.deleteMany).toHaveBeenCalledWith({
      where: { appointmentId: 'appointment-1' },
    });
    expect(appointment.delete).toHaveBeenCalledWith({
      where: { id: 'appointment-1' },
    });
  });
});
