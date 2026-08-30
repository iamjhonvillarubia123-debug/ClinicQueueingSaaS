import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AppointmentStatus, Weekday } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const WEEKDAYS: Weekday[] = [
  Weekday.SUNDAY,
  Weekday.MONDAY,
  Weekday.TUESDAY,
  Weekday.WEDNESDAY,
  Weekday.THURSDAY,
  Weekday.FRIDAY,
  Weekday.SATURDAY,
];

@Injectable()
export class PracticeLocationOperationsService {
  constructor(private readonly prisma: PrismaService) {}

  async getQueue(userId: string, practiceLocationId: string, serviceDateInput: string) {
    const overview = await this.getOverview(userId, practiceLocationId, serviceDateInput);
    const serviceDate = this.parseServiceDate(serviceDateInput);
    const appointments = await this.prisma.appointment.findMany({
      where: { practiceLocationId, serviceDate },
      orderBy: [{ servingOrderKey: 'asc' }, { queueNumber: 'asc' }],
      select: {
        id: true, bookingReference: true, queueNumber: true, firstName: true, lastName: true, status: true,
        estimatedServiceMinutes: true, servingOrderKey: true, waitingPlacementType: true, calledAt: true,
        completedAt: true, createdAt: true, createdByUserId: true,
        bookedServices: { orderBy: { createdAt: 'asc' }, select: { serviceNameSnapshot: true } },
      },
    });
    return {
      clinic: overview.clinic,
      serviceDate: overview.serviceDate,
      schedule: overview.schedule,
      clinicDay: overview.clinicDay,
      counts: overview.queue.counts,
      patients: appointments.map((appointment) => ({
        ...this.toQueuePatient(appointment),
        source: appointment.createdByUserId ? 'STAFF_ASSISTED' : 'ONLINE',
        waitingPlacementType: appointment.waitingPlacementType,
        servingOrderKey: appointment.servingOrderKey?.toString() ?? null,
      })),
      timeline: overview.timeline,
    };
  }

  async getOverview(userId: string, practiceLocationId: string, serviceDateInput: string) {
    const serviceDate = this.parseServiceDate(serviceDateInput);
    const doctor = await this.prisma.doctorProfile.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!doctor) throw new ForbiddenException('Only a doctor may view clinic operations.');

    const location = await this.prisma.practiceLocation.findFirst({
      where: { id: practiceLocationId, doctorProfileId: doctor.id },
      select: {
        id: true,
        name: true,
        addressLine1: true,
        cityMunicipality: true,
        province: true,
        countryCode: true,
        timeZone: true,
        lifecycleStatus: true,
        doctorProfile: { select: { professionalTitle: true, user: { select: { firstName: true, lastName: true } } } },
        practiceSchedules: {
          where: { weekday: WEEKDAYS[serviceDate.getUTCDay()] },
          select: { isOpen: true, opensAtLocal: true, closesAtLocal: true },
        },
        clinicDays: {
          where: { serviceDate },
          select: {
            id: true,
            status: true,
            openingOverrideAt: true,
            startedAt: true,
            closedAt: true,
            operatingPracticeStaff: {
              select: { id: true, user: { select: { id: true, firstName: true, lastName: true } } },
            },
          },
        },
      },
    });
    if (!location) throw new NotFoundException('Practice location was not found.');

    const [appointments, timeline] = await Promise.all([
      this.prisma.appointment.findMany({
        where: { practiceLocationId, serviceDate },
        orderBy: [{ servingOrderKey: 'asc' }, { queueNumber: 'asc' }],
        select: {
          id: true,
          bookingReference: true,
          queueNumber: true,
          firstName: true,
          lastName: true,
          status: true,
          estimatedServiceMinutes: true,
          calledAt: true,
          completedAt: true,
          createdAt: true,
          bookedServices: { orderBy: { createdAt: 'asc' }, select: { serviceNameSnapshot: true } },
        },
      }),
      this.prisma.queueEvent.findMany({
        where: { practiceLocationId, serviceDate },
        orderBy: { queueEventSequence: 'desc' },
        take: 8,
        select: {
          id: true,
          type: true,
          createdAt: true,
          actorUser: { select: { firstName: true, lastName: true } },
          appointmentLinks: {
            take: 1,
            select: { appointment: { select: { queueNumber: true, firstName: true, lastName: true } } },
          },
        },
      }),
    ]);

    const clinicDay = location.clinicDays[0] ?? null;
    const schedule = location.practiceSchedules[0] ?? null;
    const counts = Object.values(AppointmentStatus).reduce<Record<string, number>>((result, status) => {
      result[status] = appointments.filter((appointment) => appointment.status === status).length;
      return result;
    }, {});
    const waiting = appointments.filter((appointment) => appointment.status === AppointmentStatus.WAITING);
    const nowServing = appointments.find((appointment) => appointment.status === AppointmentStatus.CALLED) ?? null;

    return {
      clinic: {
        id: location.id,
        name: location.name,
        address: [location.addressLine1, location.cityMunicipality, location.province].filter(Boolean).join(', '),
        countryCode: location.countryCode,
        timeZone: location.timeZone,
        lifecycleStatus: location.lifecycleStatus,
        doctorName: `${location.doctorProfile.professionalTitle} ${location.doctorProfile.user.firstName} ${location.doctorProfile.user.lastName}`.trim(),
      },
      serviceDate: serviceDateInput,
      schedule: schedule ? { isOpen: schedule.isOpen, opensAt: this.formatTime(schedule.opensAtLocal), closesAt: this.formatTime(schedule.closesAtLocal) } : null,
      clinicDay: clinicDay ? {
        id: clinicDay.id,
        status: clinicDay.status,
        openingOverrideAt: clinicDay.openingOverrideAt,
        startedAt: clinicDay.startedAt,
        closedAt: clinicDay.closedAt,
        operatingSecretary: clinicDay.operatingPracticeStaff ? {
          practiceStaffId: clinicDay.operatingPracticeStaff.id,
          userId: clinicDay.operatingPracticeStaff.user.id,
          name: `${clinicDay.operatingPracticeStaff.user.firstName} ${clinicDay.operatingPracticeStaff.user.lastName}`,
        } : null,
      } : null,
      queue: {
        counts,
        waitingCount: waiting.length,
        nowServing: nowServing ? this.toQueuePatient(nowServing) : null,
        next: waiting[0] ? this.toQueuePatient(waiting[0]) : null,
        waitingPreview: waiting.slice(0, 3).map((appointment) => this.toQueuePatient(appointment)),
      },
      appointments: { total: appointments.length, counts },
      timeline: timeline.reverse().map((event) => ({
        id: event.id,
        type: event.type,
        occurredAt: event.createdAt,
        actorName: event.actorUser ? `${event.actorUser.firstName} ${event.actorUser.lastName}` : null,
        patient: event.appointmentLinks[0]?.appointment ? {
          queueNumber: event.appointmentLinks[0].appointment.queueNumber,
          name: [event.appointmentLinks[0].appointment.firstName, event.appointmentLinks[0].appointment.lastName].filter(Boolean).join(' '),
        } : null,
      })),
    };
  }

  private parseServiceDate(value: string): Date {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? '')) throw new BadRequestException('serviceDate must use YYYY-MM-DD.');
    const date = new Date(`${value}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new BadRequestException('serviceDate is invalid.');
    return date;
  }

  private formatTime(value: Date | null): string | null {
    return value ? value.toISOString().slice(11, 16) : null;
  }

  private toQueuePatient(appointment: {
    id: string; bookingReference: string; queueNumber: number; firstName: string | null; lastName: string | null;
    status: AppointmentStatus; estimatedServiceMinutes: number; calledAt: Date | null; completedAt: Date | null; createdAt: Date;
    bookedServices: Array<{ serviceNameSnapshot: string }>;
  }) {
    return {
      id: appointment.id,
      bookingReference: appointment.bookingReference,
      queueNumber: appointment.queueNumber,
      name: [appointment.firstName, appointment.lastName].filter(Boolean).join(' ') || 'Patient',
      status: appointment.status,
      estimatedServiceMinutes: appointment.estimatedServiceMinutes,
      serviceNames: appointment.bookedServices.map((service) => service.serviceNameSnapshot),
      enteredAt: appointment.createdAt,
      calledAt: appointment.calledAt,
      completedAt: appointment.completedAt,
    };
  }
}
