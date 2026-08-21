import {
  AppointmentStatus,
  RetentionHoldReasonCategory,
  UserAccountStatus,
  UserRole,
} from '../../generated/prisma/client';
import { PrivacyRetentionService } from './privacy-retention.service';

describe('PrivacyRetentionService', () => {
  const appointment = {
    findUnique: jest.fn(),
  };
  const retentionHold = {
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  };
  const user = {
    findUnique: jest.fn(),
  };
  const transaction = { appointment, retentionHold, user };
  const prisma = {
    appointment,
    retentionHold,
    $transaction: jest.fn((callback: (tx: typeof transaction) => unknown) =>
      callback(transaction),
    ),
  };

  const service = new PrivacyRetentionService(prisma as never);
  const terminalAt = new Date('2026-08-20T00:00:00.000Z');

  beforeEach(() => jest.clearAllMocks());

  it('blocks erasure before terminalAt plus 24 hours', async () => {
    appointment.findUnique.mockResolvedValue({
      id: 'appointment-1',
      status: AppointmentStatus.COMPLETED,
      terminalAt,
    });

    await expect(
      service.evaluateAppointmentErasureEligibility(
        'appointment-1',
        new Date('2026-08-20T23:59:59.999Z'),
      ),
    ).resolves.toEqual(
      expect.objectContaining({
        eligible: false,
        reason: 'RETENTION_WINDOW_ACTIVE',
      }),
    );
  });

  it('blocks erasure while an active retention hold exists', async () => {
    appointment.findUnique.mockResolvedValue({
      id: 'appointment-1',
      status: AppointmentStatus.CANCELLED,
      terminalAt,
    });
    retentionHold.findFirst.mockResolvedValue({ id: 'hold-1' });

    await expect(
      service.evaluateAppointmentErasureEligibility(
        'appointment-1',
        new Date('2026-08-21T00:00:00.000Z'),
      ),
    ).resolves.toEqual(
      expect.objectContaining({
        eligible: false,
        reason: 'ACTIVE_RETENTION_HOLD',
      }),
    );
  });

  it('allows erasure after the retention window when no active hold exists', async () => {
    appointment.findUnique.mockResolvedValue({
      id: 'appointment-1',
      status: AppointmentStatus.EXPIRED,
      terminalAt,
    });
    retentionHold.findFirst.mockResolvedValue(null);

    await expect(
      service.evaluateAppointmentErasureEligibility(
        'appointment-1',
        new Date('2026-08-21T00:00:00.000Z'),
      ),
    ).resolves.toEqual(
      expect.objectContaining({ eligible: true, reason: 'ELIGIBLE' }),
    );
  });

  it('requires active SYSTEM_ADMIN authority to create a hold', async () => {
    user.findUnique.mockResolvedValue({
      role: UserRole.DOCTOR,
      accountStatus: UserAccountStatus.ACTIVE,
    });

    await expect(
      service.createAppointmentRetentionHold({
        appointmentId: 'appointment-1',
        createdByUserId: 'doctor-1',
        reasonCategory: RetentionHoldReasonCategory.LEGAL_REQUIREMENT,
        explanation: 'Preserve for legal requirement',
        reviewAt: new Date('2026-08-22T00:00:00.000Z'),
        expiresAt: new Date('2026-08-23T00:00:00.000Z'),
        now: new Date('2026-08-21T00:00:00.000Z'),
      }),
    ).rejects.toThrow('Active SYSTEM_ADMIN authority is required.');
  });

  it('creates a bounded hold for an existing Appointment', async () => {
    user.findUnique.mockResolvedValue({
      role: UserRole.SYSTEM_ADMIN,
      accountStatus: UserAccountStatus.ACTIVE,
    });
    appointment.findUnique.mockResolvedValue({ id: 'appointment-1' });
    retentionHold.create.mockResolvedValue({ id: 'hold-1' });

    await expect(
      service.createAppointmentRetentionHold({
        appointmentId: 'appointment-1',
        createdByUserId: 'admin-1',
        reasonCategory: RetentionHoldReasonCategory.PRESERVATION_ORDER,
        explanation: ' Preserve minimum required evidence ',
        reference: ' CASE-123 ',
        reviewAt: new Date('2026-08-22T00:00:00.000Z'),
        expiresAt: new Date('2026-08-23T00:00:00.000Z'),
        now: new Date('2026-08-21T00:00:00.000Z'),
      }),
    ).resolves.toEqual({ id: 'hold-1' });

    expect(retentionHold.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          resourceId: 'appointment-1',
          explanation: 'Preserve minimum required evidence',
          reference: 'CASE-123',
        }) as Record<string, unknown>,
      }),
    );
  });
});
