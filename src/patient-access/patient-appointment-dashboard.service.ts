import {
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  AdministrativeRestrictionStatus,
  AppointmentStatus,
  BookingAccessTokenPurpose,
  ClinicDayStatus,
  PracticeLocationLifecycleStatus,
  Prisma,
  UserAccountStatus,
  Weekday,
} from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PatientBookingAccessService } from './patient-booking-access.service';

type TransactionClient = Prisma.TransactionClient;

type DashboardAppointment = {
  id: string;
  bookingReference: string;
  practiceLocationId: string;
  practiceLocationName: string;
  serviceDate: Date;
  queueNumber: number;
  status: AppointmentStatus;
  bookingGroupId: string | null;
  servingOrderKey: Prisma.Decimal | null;
  selfServiceReinsertedAt: Date | null;
  estimatedServiceMinutes: number;
  firstName: string | null;
  middleName: string | null;
  lastName: string | null;
  suffix: string | null;
  practiceLocationLifecycleStatus: PracticeLocationLifecycleStatus;
  doctorAccountStatus: UserAccountStatus;
  doctorAdministrativeRestrictionStatus: AdministrativeRestrictionStatus;
  entitlementGraceEndsAt: Date | null;
  clinicDayStatus: ClinicDayStatus | null;
};

type ScheduledClinicHours = {
  opensAtLocal: string;
  closesAtLocal: string;
};

@Injectable()
export class PatientAppointmentDashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly patientAccess: PatientBookingAccessService,
  ) {}

  async read(
    bookingReference: string,
    rawToken: string,
  ): Promise<{
    bookingReference: string;
    patientName: {
      firstName: string | null;
      middleName: string | null;
      lastName: string | null;
      suffix: string | null;
    };
    practiceLocation: { id: string; name: string };
    serviceDate: Date;
    queueNumber: number;
    status: AppointmentStatus;
    estimatedServiceMinutes: number;
    bookedServices: string[];
    scheduledClinicHours: ScheduledClinicHours | null;
    clinicDayStatus: ClinicDayStatus | null;
    nowServingQueueNumber: number | null;
    patientsAhead: number | null;
    estimatedWaitMinutes: number | null;
    canUseImHere: boolean;
  }> {
    return this.prisma.$transaction(async (transaction) => {
      const access = await this.patientAccess.validateReadToken(
        transaction,
        rawToken,
        bookingReference,
      );
      const appointment = await this.loadAppointment(
        transaction,
        access.appointment.id,
      );
      this.assertOnlineServiceAvailable(appointment);

      const [
        nowServingQueueNumber,
        queueMetrics,
        bookedServices,
        scheduledClinicHours,
      ] = await Promise.all([
        this.readNowServingQueueNumber(transaction, appointment),
        this.readQueueMetrics(transaction, appointment),
        this.readBookedServices(transaction, appointment.id),
        this.readScheduledClinicHours(transaction, appointment),
      ]);

      return {
        bookingReference: appointment.bookingReference,
        patientName: {
          firstName: appointment.firstName,
          middleName: appointment.middleName,
          lastName: appointment.lastName,
          suffix: appointment.suffix,
        },
        practiceLocation: {
          id: appointment.practiceLocationId,
          name: appointment.practiceLocationName,
        },
        serviceDate: appointment.serviceDate,
        queueNumber: appointment.queueNumber,
        status: appointment.status,
        estimatedServiceMinutes: appointment.estimatedServiceMinutes,
        bookedServices,
        scheduledClinicHours,
        clinicDayStatus: appointment.clinicDayStatus,
        nowServingQueueNumber,
        patientsAhead: queueMetrics.patientsAhead,
        estimatedWaitMinutes: queueMetrics.estimatedWaitMinutes,
        canUseImHere: this.canUseImHere(appointment, access.purpose),
      };
    });
  }

  private async loadAppointment(
    transaction: TransactionClient,
    appointmentId: string,
  ): Promise<DashboardAppointment> {
    const rows = await transaction.$queryRaw<DashboardAppointment[]>(Prisma.sql`
      SELECT
        a."id",
        a."bookingReference",
        a."practiceLocationId",
        pl."name" AS "practiceLocationName",
        a."serviceDate",
        a."queueNumber",
        a."status",
        a."bookingGroupId",
        a."servingOrderKey",
        a."selfServiceReinsertedAt",
        a."estimatedServiceMinutes",
        a."firstName",
        a."middleName",
        a."lastName",
        a."suffix",
        pl."lifecycleStatus" AS "practiceLocationLifecycleStatus",
        u."accountStatus" AS "doctorAccountStatus",
        u."administrativeRestrictionStatus" AS "doctorAdministrativeRestrictionStatus",
        dse."graceEndsAt" AS "entitlementGraceEndsAt",
        cd."status" AS "clinicDayStatus"
      FROM "Appointment" a
      INNER JOIN "PracticeLocation" pl
        ON pl."id" = a."practiceLocationId"
      INNER JOIN "DoctorProfile" dp
        ON dp."id" = pl."doctorProfileId"
      INNER JOIN "User" u
        ON u."id" = dp."userId"
      LEFT JOIN "DoctorFinancialAccount" dfa
        ON dfa."doctorUserId" = u."id"
      LEFT JOIN "DoctorSubscriptionEntitlement" dse
        ON dse."doctorFinancialAccountId" = dfa."id"
      LEFT JOIN "ClinicDay" cd
        ON cd."practiceLocationId" = a."practiceLocationId"
        AND cd."serviceDate" = a."serviceDate"
      WHERE a."id" = ${appointmentId}
        AND a."anonymizedAt" IS NULL
      LIMIT 1
    `);
    const appointment = rows[0];
    if (!appointment) {
      throw new UnauthorizedException('Patient booking access is unavailable.');
    }
    return appointment;
  }

  private assertOnlineServiceAvailable(
    appointment: DashboardAppointment,
  ): void {
    const now = new Date();
    const eligible =
      appointment.practiceLocationLifecycleStatus ===
        PracticeLocationLifecycleStatus.ACTIVE &&
      appointment.doctorAccountStatus === UserAccountStatus.ACTIVE &&
      appointment.doctorAdministrativeRestrictionStatus ===
        AdministrativeRestrictionStatus.NONE &&
      appointment.entitlementGraceEndsAt !== null &&
      appointment.entitlementGraceEndsAt.getTime() > now.getTime();

    if (!eligible) {
      throw new ServiceUnavailableException(
        'This online service is temporarily unavailable. Your existing appointment has not been cancelled. Please try again later.',
      );
    }
  }

  private async readNowServingQueueNumber(
    transaction: TransactionClient,
    appointment: DashboardAppointment,
  ): Promise<number | null> {
    if (appointment.clinicDayStatus !== ClinicDayStatus.STARTED) {
      return null;
    }

    const current = await transaction.appointment.findFirst({
      where: {
        practiceLocationId: appointment.practiceLocationId,
        serviceDate: appointment.serviceDate,
        status: AppointmentStatus.CALLED,
      },
      select: { queueNumber: true },
      orderBy: { calledAt: 'asc' },
    });
    return current?.queueNumber ?? null;
  }

  private async readQueueMetrics(
    transaction: TransactionClient,
    appointment: DashboardAppointment,
  ): Promise<{ patientsAhead: number | null; estimatedWaitMinutes: number | null }> {
    if (
      appointment.clinicDayStatus !== ClinicDayStatus.STARTED ||
      appointment.status !== AppointmentStatus.WAITING ||
      appointment.servingOrderKey === null
    ) {
      return { patientsAhead: null, estimatedWaitMinutes: null };
    }

    const [called, ahead] = await Promise.all([
      transaction.appointment.findFirst({
        where: {
          practiceLocationId: appointment.practiceLocationId,
          serviceDate: appointment.serviceDate,
          status: AppointmentStatus.CALLED,
        },
        select: { estimatedServiceMinutes: true },
        orderBy: { calledAt: 'asc' },
      }),
      transaction.appointment.aggregate({
        where: {
          practiceLocationId: appointment.practiceLocationId,
          serviceDate: appointment.serviceDate,
          status: AppointmentStatus.WAITING,
          servingOrderKey: { lt: appointment.servingOrderKey },
        },
        _count: { _all: true },
        _sum: { estimatedServiceMinutes: true },
      }),
    ]);

    return {
      patientsAhead: ahead._count._all,
      estimatedWaitMinutes:
        (called?.estimatedServiceMinutes ?? 0) +
        (ahead._sum.estimatedServiceMinutes ?? 0),
    };
  }

  private async readBookedServices(
    transaction: TransactionClient,
    appointmentId: string,
  ): Promise<string[]> {
    const rows = await transaction.appointmentBookedService.findMany({
      where: { appointmentId },
      select: { serviceNameSnapshot: true },
      orderBy: { serviceNameSnapshot: 'asc' },
    });
    return rows.map((row) => row.serviceNameSnapshot);
  }

  private async readScheduledClinicHours(
    transaction: TransactionClient,
    appointment: DashboardAppointment,
  ): Promise<ScheduledClinicHours | null> {
    const exception = await transaction.scheduleException.findFirst({
      where: {
        practiceLocationId: appointment.practiceLocationId,
        serviceDate: appointment.serviceDate,
      },
      select: {
        isOpen: true,
        opensAtLocal: true,
        closesAtLocal: true,
      },
    });

    if (exception) {
      return this.toScheduledClinicHours(exception);
    }

    const recurring = await transaction.practiceSchedule.findFirst({
      where: {
        practiceLocationId: appointment.practiceLocationId,
        weekday: this.weekdayForServiceDate(appointment.serviceDate),
      },
      select: {
        isOpen: true,
        opensAtLocal: true,
        closesAtLocal: true,
      },
    });

    return recurring ? this.toScheduledClinicHours(recurring) : null;
  }

  private toScheduledClinicHours(schedule: {
    isOpen: boolean;
    opensAtLocal: Date | null;
    closesAtLocal: Date | null;
  }): ScheduledClinicHours | null {
    if (!schedule.isOpen || !schedule.opensAtLocal || !schedule.closesAtLocal) {
      return null;
    }

    return {
      opensAtLocal: this.formatLocalTime(schedule.opensAtLocal),
      closesAtLocal: this.formatLocalTime(schedule.closesAtLocal),
    };
  }

  private formatLocalTime(value: Date): string {
    return `${String(value.getUTCHours()).padStart(2, '0')}:${String(
      value.getUTCMinutes(),
    ).padStart(2, '0')}`;
  }

  private weekdayForServiceDate(serviceDate: Date): Weekday {
    const weekdays: Weekday[] = [
      Weekday.SUNDAY,
      Weekday.MONDAY,
      Weekday.TUESDAY,
      Weekday.WEDNESDAY,
      Weekday.THURSDAY,
      Weekday.FRIDAY,
      Weekday.SATURDAY,
    ];
    return weekdays[serviceDate.getUTCDay()];
  }

  private canUseImHere(
    appointment: DashboardAppointment,
    purpose: BookingAccessTokenPurpose,
  ): boolean {
    return (
      purpose === BookingAccessTokenPurpose.VIEW_AND_MANAGE_BOOKING &&
      appointment.clinicDayStatus === ClinicDayStatus.STARTED &&
      appointment.bookingGroupId === null &&
      appointment.status === AppointmentStatus.TEMPORARILY_ABSENT &&
      appointment.selfServiceReinsertedAt === null
    );
  }
}
