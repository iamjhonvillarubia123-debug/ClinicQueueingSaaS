import { createHash } from 'crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  AppointmentCancelledByType,
  AppointmentStatus,
  DoctorCalendarRecurrenceType,
  DoctorCalendarRuleStatus,
  NotificationChannel,
  NotificationOutboxStatus,
  NotificationType,
  PracticeLocationLifecycleStatus,
  Prisma,
  QueueEventActorType,
  QueueEventAppointmentLinkRole,
  QueueEventType,
} from '../../generated/prisma/client';
import { PasswordSecurityService } from '../auth/security/password-security.service';
import { NotificationPayloadService } from '../notification/notification-payload.service';
import { PrismaService } from '../prisma/prisma.service';
import { ConfirmDoctorCalendarRuleDto } from './dto/confirm-doctor-calendar-rule.dto';

const ACTIVE_APPOINTMENT_STATUSES = [
  AppointmentStatus.WAITING,
  AppointmentStatus.CALLED,
  AppointmentStatus.TEMPORARILY_ABSENT,
  AppointmentStatus.OUT_FOR_PROCEDURE,
];
const OUTBOX_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

@Injectable()
export class DoctorCalendarWorkspaceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordSecurityService,
    private readonly notificationPayload: NotificationPayloadService,
  ) {}

  async getMonth(userId: string, month: string) {
    if (!/^\d{4}-\d{2}$/.test(month))
      throw new BadRequestException('Month must use YYYY-MM.');
    const doctor = await this.requireDoctor(userId);
    const start = new Date(`${month}-01T00:00:00.000Z`);
    if (Number.isNaN(start.getTime()))
      throw new BadRequestException('Month is invalid.');
    const end = new Date(
      Date.UTC(start.getUTCFullYear() + 1, start.getUTCMonth(), 1),
    );
    const [rules, clinics] = await Promise.all([
      this.prisma.doctorCalendarRule.findMany({
        where: {
          doctorProfileId: doctor.id,
          status: DoctorCalendarRuleStatus.ACTIVE,
          startDate: { lt: end },
          OR: [{ endDate: null }, { endDate: { gte: start } }],
        },
        orderBy: { startDate: 'asc' },
        include: { weeklyWeekdays: true },
      }),
      this.prisma.practiceLocation.findMany({
        where: {
          doctorProfileId: doctor.id,
          lifecycleStatus: PracticeLocationLifecycleStatus.ACTIVE,
        },
        select: {
          id: true,
          name: true,
          cityMunicipality: true,
          timeZone: true,
          practiceSchedules: {
            where: { isOpen: true },
            orderBy: { weekday: 'asc' },
          },
        },
        orderBy: { name: 'asc' },
      }),
    ]);
    return {
      month,
      timeZone: doctor.accountSettings?.defaultTimeZone ?? 'Asia/Manila',
      rules,
      clinics,
    };
  }

  async create(userId: string, date: string, label?: string) {
    const result = await this.confirmUnavailable(userId, {
      date,
      cancelAffectedAppointments: false,
    });
    if (label?.trim() && result.rule.customLabel !== label.trim()) {
      return this.prisma.doctorCalendarRule.update({
        where: { id: result.rule.id },
        data: { customLabel: label.trim() },
      });
    }
    return result.rule;
  }

  async impact(userId: string, date: string) {
    const doctor = await this.requireDoctor(userId);
    const day = this.date(date);
    const appointments = await this.prisma.appointment.findMany({
      where: {
        serviceDate: day,
        status: { in: ACTIVE_APPOINTMENT_STATUSES },
        practiceLocation: { doctorProfileId: doctor.id },
      },
      select: {
        id: true,
        bookingReference: true,
        queueNumber: true,
        firstName: true,
        lastName: true,
        status: true,
        practiceLocation: { select: { id: true, name: true } },
      },
      orderBy: [{ practiceLocation: { name: 'asc' } }, { queueNumber: 'asc' }],
    });
    const clinics = new Map<
      string,
      { clinicId: string; clinicName: string; appointmentCount: number }
    >();
    for (const appointment of appointments) {
      const clinicId = appointment.practiceLocation.id;
      const current = clinics.get(clinicId) ?? {
        clinicId,
        clinicName: appointment.practiceLocation.name ?? 'Unnamed clinic',
        appointmentCount: 0,
      };
      current.appointmentCount += 1;
      clinics.set(clinicId, current);
    }
    return {
      date,
      appointmentCount: appointments.length,
      requiresPassword: appointments.length > 0,
      clinics: [...clinics.values()],
      appointments: appointments.map((appointment) => ({
        id: appointment.id,
        bookingReference: appointment.bookingReference,
        queueNumber: appointment.queueNumber,
        patientName:
          [appointment.firstName, appointment.lastName]
            .filter(Boolean)
            .join(' ') || 'Patient',
        status: appointment.status,
        clinicId: appointment.practiceLocation.id,
        clinicName: appointment.practiceLocation.name ?? 'Unnamed clinic',
      })),
    };
  }

  async confirmUnavailable(userId: string, dto: ConfirmDoctorCalendarRuleDto) {
    const doctor = await this.requireDoctor(userId);
    const day = this.date(dto.date);
    const initialCount = await this.prisma.appointment.count({
      where: {
        serviceDate: day,
        status: { in: ACTIVE_APPOINTMENT_STATUSES },
        practiceLocation: { doctorProfileId: doctor.id },
      },
    });
    if (initialCount && !dto.cancelAffectedAppointments) {
      throw new ConflictException(
        'Affected appointments must be cancelled before this date can be marked unavailable.',
      );
    }
    if (initialCount) {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { passwordHash: true },
      });
      if (
        !dto.password ||
        !user ||
        !(await this.passwords.verify(dto.password, user.passwordHash))
      ) {
        throw new UnauthorizedException('Current password is incorrect.');
      }
    }
    return this.prisma.$transaction(async (transaction) => {
      await transaction.$executeRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`DOCTOR_SCHEDULE|${doctor.id}`}, 0))`,
      );
      const existing = await transaction.doctorCalendarRule.findFirst({
        where: {
          doctorProfileId: doctor.id,
          recurrenceType: DoctorCalendarRecurrenceType.SINGLE_DATE,
          startDate: day,
          status: DoctorCalendarRuleStatus.ACTIVE,
        },
      });
      const appointments = await transaction.appointment.findMany({
        where: {
          serviceDate: day,
          status: { in: ACTIVE_APPOINTMENT_STATUSES },
          practiceLocation: { doctorProfileId: doctor.id },
        },
        include: {
          contactPreference: { select: { allowOperationalMessages: true } },
        },
        orderBy: [{ practiceLocationId: 'asc' }, { queueNumber: 'asc' }],
      });
      if (appointments.length && !dto.cancelAffectedAppointments)
        throw new ConflictException(
          'New affected appointments were found. Review the consequences again.',
        );
      const now = new Date();
      for (const appointment of appointments) {
        await transaction.$executeRaw(
          Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`queue|${appointment.practiceLocationId}|${dto.date}`}, 0))`,
        );
        await transaction.appointment.update({
          where: { id: appointment.id },
          data: {
            status: AppointmentStatus.CANCELLED,
            servingOrderKey: null,
            waitingPlacementType: null,
            activeAppointmentKey: null,
            cancelledAt: now,
            terminalAt: now,
            cancelledByType: AppointmentCancelledByType.DOCTOR,
            cancellationReason: 'DOCTOR_CALENDAR_UNAVAILABLE',
          },
        });
        const latest = await transaction.queueEvent.findFirst({
          where: {
            practiceLocationId: appointment.practiceLocationId,
            serviceDate: day,
          },
          select: { queueEventSequence: true },
          orderBy: { queueEventSequence: 'desc' },
        });
        const event = await transaction.queueEvent.create({
          data: {
            practiceLocationId: appointment.practiceLocationId,
            serviceDate: day,
            queueEventSequence: (latest?.queueEventSequence ?? 0n) + 1n,
            type: QueueEventType.APPOINTMENT_CANCELLED,
            actorType: QueueEventActorType.USER,
            actorUserId: userId,
            previousPrimaryStatus: appointment.status,
            newPrimaryStatus: AppointmentStatus.CANCELLED,
            previousPrimaryOrderKey: appointment.servingOrderKey,
            newPrimaryOrderKey: null,
            previousPrimaryWaitingPlacementType:
              appointment.waitingPlacementType,
            newPrimaryWaitingPlacementType: null,
            previousPrimaryTerminalAt: appointment.terminalAt,
            newPrimaryTerminalAt: now,
          },
          select: { id: true },
        });
        await transaction.queueEventAppointmentLink.create({
          data: {
            queueEventId: event.id,
            role: QueueEventAppointmentLinkRole.PRIMARY,
            appointmentId: appointment.id,
          },
        });
        if (
          appointment.mobileNumberEncrypted &&
          (appointment.contactPreference?.allowOperationalMessages ?? true)
        ) {
          await transaction.notificationOutbox.create({
            data: {
              deliveryIdentityKey: this.hash(
                `${NotificationType.APPOINTMENT_CANCELLATION}|DOCTOR_CALENDAR|${event.id}|${appointment.id}`,
              ),
              notificationType: NotificationType.APPOINTMENT_CANCELLATION,
              channel: NotificationChannel.SMS,
              status: NotificationOutboxStatus.PENDING,
              practiceLocationId: appointment.practiceLocationId,
              appointmentId: appointment.id,
              recipientMobileEncrypted: appointment.mobileNumberEncrypted,
              recipientEmailEncrypted: null,
              messageBodyEncrypted: this.notificationPayload.encryptMessage(
                `Your clinic appointment on ${dto.date} has been cancelled because the Doctor is unavailable. Please contact the clinic to arrange another date.`,
              ),
              providerIdempotencyKey: `doctor-calendar-cancel:${event.id}`,
              attemptCount: 0,
              nextAttemptAt: now,
              expiresAt: new Date(now.getTime() + OUTBOX_RETENTION_MS),
              createdAt: now,
            },
          });
        }
      }
      const rule =
        existing ??
        (await transaction.doctorCalendarRule.create({
          data: {
            doctorProfileId: doctor.id,
            recurrenceType: DoctorCalendarRecurrenceType.SINGLE_DATE,
            startDate: day,
            timeZone: doctor.accountSettings?.defaultTimeZone ?? 'Asia/Manila',
            isWholeDay: true,
          },
        }));
      return { rule, cancelledAppointmentCount: appointments.length };
    });
  }

  async remove(userId: string, ruleId: string) {
    const doctor = await this.requireDoctor(userId);
    const result = await this.prisma.doctorCalendarRule.updateMany({
      where: {
        id: ruleId,
        doctorProfileId: doctor.id,
        status: DoctorCalendarRuleStatus.ACTIVE,
      },
      data: { status: DoctorCalendarRuleStatus.RETIRED, retiredAt: new Date() },
    });
    if (!result.count)
      throw new NotFoundException('Unavailable date was not found.');
    return { removed: true };
  }

  private async requireDoctor(userId: string) {
    const doctor = await this.prisma.doctorProfile.findUnique({
      where: { userId },
      include: { accountSettings: true },
    });
    if (!doctor) throw new NotFoundException('Doctor profile was not found.');
    return doctor;
  }

  private date(value: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value))
      throw new BadRequestException('Date must use YYYY-MM-DD.');
    const date = new Date(`${value}T00:00:00.000Z`);
    if (
      Number.isNaN(date.getTime()) ||
      date.toISOString().slice(0, 10) !== value
    )
      throw new BadRequestException('Date is invalid.');
    return date;
  }

  private hash(value: string) {
    return createHash('sha256').update(value, 'utf8').digest('hex');
  }
}
