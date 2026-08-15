import {
  AppointmentCancelledByType,
  AppointmentStatus,
  ClinicDayCancellationReason,
  ClinicDayStatus,
  NotificationType,
  QueueEventActorType,
  QueueEventAppointmentLinkRole,
  QueueEventType,
  WaitingPlacementType,
} from '../../generated/prisma/client';
import { NotificationPayloadService } from '../notification/notification-payload.service';
import { ClinicDayCancellationService } from './clinic-day-cancellation.service';

describe('ClinicDayCancellationService', () => {
  const tx = {
    $executeRaw: jest.fn(),
    $queryRaw: jest.fn(),
    appointment: { update: jest.fn() },
    queueEvent: { create: jest.fn() },
    queueEventAppointmentLink: { create: jest.fn() },
    notificationOutbox: { create: jest.fn() },
    clinicDay: { update: jest.fn() },
    administrativeAccountActionScope: { create: jest.fn() },
  };

  const encryptMessage = jest.fn().mockReturnValue('encrypted-message');
  const notificationPayloadService = {
    encryptMessage,
  } as unknown as NotificationPayloadService;

  const service = new ClinicDayCancellationService(notificationPayloadService);

  beforeEach(() => {
    jest.clearAllMocks();
    tx.$executeRaw.mockResolvedValue(0);
    tx.appointment.update.mockResolvedValue({});
    tx.queueEvent.create.mockResolvedValue({ id: 'queue-event-1' });
    tx.queueEventAppointmentLink.create.mockResolvedValue({});
    tx.notificationOutbox.create.mockResolvedValue({});
    tx.clinicDay.update.mockResolvedValue({});
    tx.administrativeAccountActionScope.create.mockResolvedValue({});
    encryptMessage.mockReturnValue('encrypted-message');
  });

  it('cancels active Appointments, preserves Queue Number, audits queue effects, and records emergency scope', async () => {
    const serviceDate = new Date('2026-08-15T00:00:00.000Z');
    tx.$queryRaw
      .mockResolvedValueOnce([
        {
          id: 'clinic-day-1',
          practiceLocationId: 'location-1',
          serviceDate,
          status: ClinicDayStatus.STARTED,
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 'clinic-day-1',
          practiceLocationId: 'location-1',
          serviceDate,
          status: ClinicDayStatus.STARTED,
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 'appointment-1',
          status: AppointmentStatus.WAITING,
          servingOrderKey: null,
          waitingPlacementType: WaitingPlacementType.ORDINARY,
          terminalAt: null,
          mobileNumberEncrypted: 'encrypted-mobile',
          allowOperationalMessages: true,
        },
      ])
      .mockResolvedValueOnce([{ nextSequence: 7n }]);

    await expect(
      service.cancelDoctorOperationsForEmergency(
        tx as never,
        'doctor-1',
        'admin-1',
        'emergency-action-1',
        new Date('2026-08-15T10:00:00.000Z'),
      ),
    ).resolves.toEqual({ stoppedClinicDayCount: 1 });

    expect(tx.appointment.update).toHaveBeenCalledWith({
      where: { id: 'appointment-1' },
      data: expect.objectContaining({
        status: AppointmentStatus.CANCELLED,
        servingOrderKey: null,
        waitingPlacementType: null,
        cancelledByType: AppointmentCancelledByType.SYSTEM,
      }) as unknown,
    });
    expect(tx.queueEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        practiceLocationId: 'location-1',
        serviceDate,
        queueEventSequence: 7n,
        type: QueueEventType.APPOINTMENT_CANCELLED,
        actorType: QueueEventActorType.USER,
        actorUserId: 'admin-1',
        previousPrimaryStatus: AppointmentStatus.WAITING,
        newPrimaryStatus: AppointmentStatus.CANCELLED,
      }) as unknown,
      select: { id: true },
    });
    expect(tx.queueEventAppointmentLink.create).toHaveBeenCalledWith({
      data: {
        queueEventId: 'queue-event-1',
        role: QueueEventAppointmentLinkRole.PRIMARY,
        appointmentId: 'appointment-1',
      },
    });
    expect(tx.notificationOutbox.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        notificationType: NotificationType.CLINIC_DAY_CANCELLATION,
        practiceLocationId: 'location-1',
        appointmentId: 'appointment-1',
        administrativeAccountActionId: 'emergency-action-1',
        recipientMobileEncrypted: 'encrypted-mobile',
        messageBodyEncrypted: 'encrypted-message',
      }) as unknown,
    });
    expect(tx.clinicDay.update).toHaveBeenCalledWith({
      where: { id: 'clinic-day-1' },
      data: expect.objectContaining({
        status: ClinicDayStatus.CANCELLED,
        cancelledByUserId: 'admin-1',
        cancellationReason: ClinicDayCancellationReason.OTHER,
      }) as unknown,
    });
    expect(tx.administrativeAccountActionScope.create).toHaveBeenCalledWith({
      data: {
        administrativeAccountActionId: 'emergency-action-1',
        practiceLocationId: 'location-1',
        clinicDayId: 'clinic-day-1',
      },
    });
  });

  it('does nothing when the Doctor has no cancellable ClinicDay', async () => {
    tx.$queryRaw.mockResolvedValueOnce([]);

    await expect(
      service.cancelDoctorOperationsForEmergency(
        tx as never,
        'doctor-1',
        'admin-1',
        'emergency-action-1',
        new Date('2026-08-15T10:00:00.000Z'),
      ),
    ).resolves.toEqual({ stoppedClinicDayCount: 0 });

    expect(tx.clinicDay.update).not.toHaveBeenCalled();
    expect(tx.appointment.update).not.toHaveBeenCalled();
    expect(tx.administrativeAccountActionScope.create).not.toHaveBeenCalled();
  });
});
