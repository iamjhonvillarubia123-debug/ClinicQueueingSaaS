import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  DoctorCalendarRecurrenceType,
  DoctorCalendarRuleStatus,
  PracticeLocationLifecycleStatus,
} from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class DoctorCalendarWorkspaceService {
  constructor(private readonly prisma: PrismaService) {}

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
    const doctor = await this.requireDoctor(userId);
    const day = this.date(date);
    const existing = await this.prisma.doctorCalendarRule.findFirst({
      where: {
        doctorProfileId: doctor.id,
        recurrenceType: DoctorCalendarRecurrenceType.SINGLE_DATE,
        startDate: day,
        status: DoctorCalendarRuleStatus.ACTIVE,
      },
    });
    if (existing) return existing;
    return this.prisma.doctorCalendarRule.create({
      data: {
        doctorProfileId: doctor.id,
        recurrenceType: DoctorCalendarRecurrenceType.SINGLE_DATE,
        startDate: day,
        timeZone: doctor.accountSettings?.defaultTimeZone ?? 'Asia/Manila',
        isWholeDay: true,
        customLabel: label?.trim() || null,
      },
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
}
