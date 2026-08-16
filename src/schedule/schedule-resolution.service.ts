import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  PracticeLocationLifecycleStatus,
  Prisma,
} from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ScheduleTimeService } from './schedule-time.service';

export type ResolvedPlannedSchedule = {
  practiceLocationId: string;
  serviceDate: string;
  timeZone: string;
  isOpen: boolean;
  source: 'SCHEDULE_EXCEPTION' | 'PRACTICE_SCHEDULE' | 'NO_SCHEDULE';
  opensAt: Date | null;
  closesAt: Date | null;
  maximumOnlineBookingUntilAt: Date | null;
  maximumOperatingUntilAt: Date | null;
};

type ScheduleClient = Pick<
  Prisma.TransactionClient,
  'practiceLocation' | 'scheduleException' | 'practiceSchedule'
>;

@Injectable()
export class ScheduleResolutionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scheduleTime: ScheduleTimeService,
  ) {}

  async resolveConfiguredSchedule(
    practiceLocationId: string,
    serviceDate: string,
    transaction?: ScheduleClient,
  ): Promise<ResolvedPlannedSchedule> {
    const db: ScheduleClient = transaction ?? this.prisma;
    const date = this.scheduleTime.parseServiceDate(serviceDate);
    const location = await db.practiceLocation.findUnique({
      where: { id: practiceLocationId },
      select: { id: true, timeZone: true },
    });
    if (!location) {
      throw new NotFoundException('Practice location was not found.');
    }
    if (!location.timeZone?.trim()) {
      throw new BadRequestException(
        'Practice location time zone must be configured before schedule resolution.',
      );
    }
    const timeZone = location.timeZone.trim();
    this.scheduleTime.assertValidTimeZone(timeZone);

    const dateValue = new Date(Date.UTC(date.year, date.month - 1, date.day));
    const exception = await db.scheduleException.findUnique({
      where: {
        practiceLocationId_serviceDate: {
          practiceLocationId,
          serviceDate: dateValue,
        },
      },
    });
    if (exception) {
      return this.resolveRow(
        practiceLocationId,
        serviceDate,
        timeZone,
        date,
        'SCHEDULE_EXCEPTION',
        exception,
      );
    }

    const weekday = this.scheduleTime.weekday(date);
    const recurring = await db.practiceSchedule.findUnique({
      where: {
        practiceLocationId_weekday: { practiceLocationId, weekday },
      },
    });
    if (!recurring) {
      return {
        practiceLocationId,
        serviceDate,
        timeZone,
        isOpen: false,
        source: 'NO_SCHEDULE',
        opensAt: null,
        closesAt: null,
        maximumOnlineBookingUntilAt: null,
        maximumOperatingUntilAt: null,
      };
    }

    return this.resolveRow(
      practiceLocationId,
      serviceDate,
      timeZone,
      date,
      'PRACTICE_SCHEDULE',
      recurring,
    );
  }

  async resolveOperationalSchedule(
    practiceLocationId: string,
    serviceDate: string,
    transaction?: ScheduleClient,
  ): Promise<ResolvedPlannedSchedule> {
    const db: ScheduleClient = transaction ?? this.prisma;
    const location = await db.practiceLocation.findUnique({
      where: { id: practiceLocationId },
      select: { lifecycleStatus: true },
    });
    if (!location) {
      throw new NotFoundException('Practice location was not found.');
    }
    if (location.lifecycleStatus !== PracticeLocationLifecycleStatus.ACTIVE) {
      const configured = await this.resolveConfiguredSchedule(
        practiceLocationId,
        serviceDate,
        db,
      );
      return {
        ...configured,
        isOpen: false,
        opensAt: null,
        closesAt: null,
        maximumOnlineBookingUntilAt: null,
        maximumOperatingUntilAt: null,
      };
    }
    return this.resolveConfiguredSchedule(practiceLocationId, serviceDate, db);
  }

  private resolveRow(
    practiceLocationId: string,
    serviceDate: string,
    timeZone: string,
    date: { year: number; month: number; day: number },
    source: 'SCHEDULE_EXCEPTION' | 'PRACTICE_SCHEDULE',
    row: {
      isOpen: boolean;
      opensAtLocal: Date | null;
      closesAtLocal: Date | null;
      maximumOnlineBookingUntilLocal: Date | null;
      maximumOperatingUntilLocal: Date | null;
    },
  ): ResolvedPlannedSchedule {
    if (!row.isOpen) {
      if (
        row.opensAtLocal ||
        row.closesAtLocal ||
        row.maximumOnlineBookingUntilLocal ||
        row.maximumOperatingUntilLocal
      ) {
        throw new BadRequestException(
          'Closed schedule rows must not contain local operating times.',
        );
      }
      return {
        practiceLocationId,
        serviceDate,
        timeZone,
        isOpen: false,
        source,
        opensAt: null,
        closesAt: null,
        maximumOnlineBookingUntilAt: null,
        maximumOperatingUntilAt: null,
      };
    }

    if (!row.opensAtLocal || !row.closesAtLocal) {
      throw new BadRequestException(
        'Open schedule rows require opening and closing times.',
      );
    }

    const opensAt = this.scheduleTime.localDateTimeToInstant(
      date,
      this.scheduleTime.timeFromDatabase(row.opensAtLocal),
      timeZone,
    );
    const closesAt = this.scheduleTime.localDateTimeToInstant(
      date,
      this.scheduleTime.timeFromDatabase(row.closesAtLocal),
      timeZone,
    );
    if (closesAt.getTime() <= opensAt.getTime()) {
      throw new BadRequestException(
        'Version 1 clinic hours must close after opening on the same local date.',
      );
    }

    const maximumOnlineBookingUntilAt = this.optionalInstant(
      row.maximumOnlineBookingUntilLocal,
      date,
      timeZone,
    );
    if (
      maximumOnlineBookingUntilAt &&
      (maximumOnlineBookingUntilAt.getTime() < opensAt.getTime() ||
        maximumOnlineBookingUntilAt.getTime() > closesAt.getTime())
    ) {
      throw new BadRequestException(
        'Public booking cutoff must fall within the planned clinic interval.',
      );
    }

    return {
      practiceLocationId,
      serviceDate,
      timeZone,
      isOpen: true,
      source,
      opensAt,
      closesAt,
      maximumOnlineBookingUntilAt,
      maximumOperatingUntilAt: this.optionalInstant(
        row.maximumOperatingUntilLocal,
        date,
        timeZone,
      ),
    };
  }

  private optionalInstant(
    value: Date | null,
    date: { year: number; month: number; day: number },
    timeZone: string,
  ): Date | null {
    if (!value) {
      return null;
    }
    return this.scheduleTime.localDateTimeToInstant(
      date,
      this.scheduleTime.timeFromDatabase(value),
      timeZone,
    );
  }
}
