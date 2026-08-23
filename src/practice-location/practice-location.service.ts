import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  PracticeLocationLifecycleStatus,
  Prisma,
  Weekday,
} from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RecurringScheduleConflictService } from '../schedule/recurring-schedule-conflict.service';
import { ScheduleTimeService } from '../schedule/schedule-time.service';
import { CreatePracticeLocationDto } from './dto/create-practice-location.dto';
import { UpdateDraftPracticeLocationDto } from './dto/update-draft-practice-location.dto';

type DraftScheduleInput = {
  weekday: Weekday;
  isOpen: boolean;
  opensAtLocal: string | null;
  closesAtLocal: string | null;
  maximumOperatingUntilLocal: string | null;
};

type LockedDraftLocation = {
  id: string;
  lifecycleStatus: PracticeLocationLifecycleStatus;
};

const WEEKDAYS = [
  Weekday.MONDAY,
  Weekday.TUESDAY,
  Weekday.WEDNESDAY,
  Weekday.THURSDAY,
  Weekday.FRIDAY,
  Weekday.SATURDAY,
  Weekday.SUNDAY,
] as const;

@Injectable()
export class PracticeLocationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scheduleTime: ScheduleTimeService,
    private readonly recurringScheduleConflict: RecurringScheduleConflictService,
  ) {}

  async create(
    userId: string,
    createPracticeLocationDto: CreatePracticeLocationDto,
  ) {
    const doctorProfile = await this.prisma.doctorProfile.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!doctorProfile) {
      throw new ForbiddenException(
        'Only a doctor may create a practice location.',
      );
    }

    const name = this.normalizeOptionalText(createPracticeLocationDto.name);
    const addressLine1 = this.normalizeOptionalText(
      createPracticeLocationDto.addressLine1,
    );

    return this.prisma.$transaction(async (transaction) => {
      if (name && addressLine1) {
        const existingLocation = await transaction.practiceLocation.findFirst({
          where: {
            doctorProfileId: doctorProfile.id,
            lifecycleStatus: PracticeLocationLifecycleStatus.ACTIVE,
            name: { equals: name, mode: 'insensitive' },
            addressLine1: { equals: addressLine1, mode: 'insensitive' },
          },
          select: { id: true },
        });
        if (existingLocation) {
          throw new ConflictException(
            'An active practice location with this name and address already exists.',
          );
        }
      }

      const [serviceTemplates, bookingQuestionTemplates] = await Promise.all([
        transaction.doctorServiceTemplate.findMany({
          where: { doctorProfileId: doctorProfile.id },
          orderBy: [{ name: 'asc' }, { id: 'asc' }],
        }),
        transaction.doctorBookingQuestionTemplate.findMany({
          where: { doctorProfileId: doctorProfile.id },
          orderBy: [{ displayOrder: 'asc' }, { id: 'asc' }],
        }),
      ]);

      const location = await transaction.practiceLocation.create({
        data: {
          doctorProfileId: doctorProfile.id,
          lifecycleStatus: PracticeLocationLifecycleStatus.DRAFT,
          name,
          addressLine1,
          addressLine2: this.normalizeOptionalText(
            createPracticeLocationDto.addressLine2,
          ),
          cityMunicipality: this.normalizeOptionalText(
            createPracticeLocationDto.cityMunicipality,
          ),
          province: this.normalizeOptionalText(
            createPracticeLocationDto.province,
          ),
          postalCode: this.normalizeOptionalText(
            createPracticeLocationDto.postalCode,
          ),
          contactNumber: this.normalizeOptionalText(
            createPracticeLocationDto.contactNumber,
          ),
          services: {
            create: serviceTemplates.map((template) => ({
              sourceDoctorServiceTemplateId: template.id,
              name: template.name,
              durationMinutes: template.durationMinutes,
              status: template.status,
            })),
          },
          bookingQuestions: {
            create: bookingQuestionTemplates.map((template) => ({
              questionText: template.questionText,
              helpText: template.helpText,
              type: template.type,
              isRequired: template.isRequired,
              displayOrder: template.displayOrder,
              isActive: template.isActive,
              estimatedMinutesAdjustment: template.estimatedMinutesAdjustment,
              textMaximumLength: template.textMaximumLength,
              numberMinimum: template.numberMinimum,
              numberMaximum: template.numberMaximum,
              selectOptions:
                template.selectOptions === null
                  ? Prisma.DbNull
                  : template.selectOptions,
            })),
          },
        },
        select: {
          id: true,
          doctorProfileId: true,
          publicIdentifier: true,
          lifecycleStatus: true,
          name: true,
          addressLine1: true,
          addressLine2: true,
          cityMunicipality: true,
          province: true,
          postalCode: true,
          contactNumber: true,
          countryCode: true,
          timeZone: true,
          isBookingEnabled: true,
          createdAt: true,
        },
      });

      for (const template of bookingQuestionTemplates) {
        await transaction.$executeRaw(Prisma.sql`
          UPDATE "BookingQuestion"
          SET "sourceDoctorBookingQuestionTemplateId" = ${template.id}
          WHERE "practiceLocationId" = ${location.id}
            AND "displayOrder" = ${template.displayOrder}
        `);
      }
      return location;
    });
  }

  async findAllForDoctor(userId: string) {
    const doctorProfile = await this.requireDoctorProfile(userId);
    return this.prisma.practiceLocation.findMany({
      where: { doctorProfileId: doctorProfile.id },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        publicIdentifier: true,
        lifecycleStatus: true,
        name: true,
        addressLine1: true,
        addressLine2: true,
        cityMunicipality: true,
        province: true,
        postalCode: true,
        contactNumber: true,
        countryCode: true,
        timeZone: true,
        isBookingEnabled: true,
        currentRegularPracticeStaffId: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  async getConfiguration(userId: string, practiceLocationId: string) {
    const doctorProfile = await this.requireDoctorProfile(userId);
    const location = await this.prisma.practiceLocation.findFirst({
      where: { id: practiceLocationId, doctorProfileId: doctorProfile.id },
      include: { practiceSchedules: { orderBy: { weekday: 'asc' } } },
    });
    if (!location) {
      throw new NotFoundException('Practice location was not found.');
    }
    const { practiceSchedules, ...details } = location;
    return { ...details, schedules: practiceSchedules };
  }

  async updateDraftConfiguration(
    userId: string,
    practiceLocationId: string,
    dto: UpdateDraftPracticeLocationDto,
  ) {
    const doctorProfile = await this.requireDoctorProfile(userId);
    const schedules = this.normalizeSchedules(dto.schedules);
    const timeZone = this.normalizeOptionalText(dto.timeZone);
    if (timeZone) {
      this.scheduleTime.assertValidTimeZone(timeZone);
    }
    if (schedules.some((schedule) => schedule.isOpen) && !timeZone) {
      throw new BadRequestException(
        'Configure a valid time zone before saving open clinic hours.',
      );
    }

    return this.prisma.$transaction(async (transaction) => {
      const rows = await transaction.$queryRaw<
        LockedDraftLocation[]
      >(Prisma.sql`
        SELECT "id", "lifecycleStatus"
        FROM "PracticeLocation"
        WHERE "id" = ${practiceLocationId}
          AND "doctorProfileId" = ${doctorProfile.id}
        LIMIT 1
        FOR UPDATE
      `);
      const location = rows[0];
      if (!location) {
        throw new NotFoundException('Practice location was not found.');
      }
      if (location.lifecycleStatus !== PracticeLocationLifecycleStatus.DRAFT) {
        throw new ConflictException(
          'This configuration editor is available only while the practice location is a draft.',
        );
      }

      await transaction.practiceLocation.update({
        where: { id: location.id },
        data: {
          name: this.normalizeOptionalText(dto.name),
          addressLine1: this.normalizeOptionalText(dto.addressLine1),
          addressLine2: this.normalizeOptionalText(dto.addressLine2),
          cityMunicipality: this.normalizeOptionalText(dto.cityMunicipality),
          province: this.normalizeOptionalText(dto.province),
          postalCode: this.normalizeOptionalText(dto.postalCode),
          contactNumber: this.normalizeOptionalText(dto.contactNumber),
          countryCode: this.normalizeCountryCode(dto.countryCode),
          timeZone,
        },
      });

      await transaction.practiceSchedule.deleteMany({
        where: { practiceLocationId: location.id },
      });
      await transaction.practiceSchedule.createMany({
        data: schedules.map((schedule) => ({
          practiceLocationId: location.id,
          weekday: schedule.weekday,
          isOpen: schedule.isOpen,
          opensAtLocal: this.databaseTime(schedule.opensAtLocal),
          closesAtLocal: this.databaseTime(schedule.closesAtLocal),
          maximumOnlineBookingUntilLocal: null,
          maximumOperatingUntilLocal: this.databaseTime(
            schedule.maximumOperatingUntilLocal,
          ),
        })),
      });

      if (timeZone) {
        await this.recurringScheduleConflict.assertNoConflictForLocation(
          doctorProfile.id,
          location.id,
          timeZone,
          transaction,
        );
      }

      const updated = await transaction.practiceLocation.findUnique({
        where: { id: location.id },
        include: { practiceSchedules: { orderBy: { weekday: 'asc' } } },
      });
      if (!updated) {
        throw new NotFoundException('Practice location was not found.');
      }
      const { practiceSchedules, ...details } = updated;
      return { ...details, schedules: practiceSchedules };
    });
  }

  private async requireDoctorProfile(userId: string) {
    const doctorProfile = await this.prisma.doctorProfile.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!doctorProfile) {
      throw new ForbiddenException(
        'Only a doctor may manage practice locations.',
      );
    }
    return doctorProfile;
  }

  private normalizeSchedules(value: unknown[]): DraftScheduleInput[] {
    if (value.length !== WEEKDAYS.length) {
      throw new BadRequestException(
        'Recurring clinic hours must include each weekday exactly once.',
      );
    }
    const seen = new Set<Weekday>();
    return value.map((raw) => {
      if (!raw || typeof raw !== 'object') {
        throw new BadRequestException('Recurring clinic hours are invalid.');
      }
      const row = raw as Record<string, unknown>;
      if (!WEEKDAYS.includes(row.weekday as Weekday)) {
        throw new BadRequestException('Recurring clinic weekday is invalid.');
      }
      const weekday = row.weekday as Weekday;
      if (seen.has(weekday)) {
        throw new BadRequestException(
          'Recurring clinic hours may contain only one interval per weekday.',
        );
      }
      seen.add(weekday);
      if (typeof row.isOpen !== 'boolean') {
        throw new BadRequestException(
          'Recurring clinic open status is invalid.',
        );
      }
      const isOpen = row.isOpen;
      const opensAtLocal = this.normalizeTime(row.opensAtLocal);
      const closesAtLocal = this.normalizeTime(row.closesAtLocal);
      const maximumOperatingUntilLocal = this.normalizeTime(
        row.maximumOperatingUntilLocal,
      );
      if (isOpen) {
        if (!opensAtLocal || !closesAtLocal) {
          throw new BadRequestException(
            'Every open recurring clinic day requires opening and closing times.',
          );
        }
        if (this.minuteOfDay(closesAtLocal) <= this.minuteOfDay(opensAtLocal)) {
          throw new BadRequestException(
            'Recurring clinic closing time must be after opening time.',
          );
        }
      } else if (opensAtLocal || closesAtLocal || maximumOperatingUntilLocal) {
        throw new BadRequestException(
          'Closed recurring clinic days must not retain operating times.',
        );
      }
      return {
        weekday,
        isOpen,
        opensAtLocal,
        closesAtLocal,
        maximumOperatingUntilLocal,
      };
    });
  }

  private normalizeTime(value: unknown): string | null {
    if (value === undefined || value === null || value === '') return null;
    if (typeof value !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) {
      throw new BadRequestException('Schedule times must use HH:MM.');
    }
    return value;
  }

  private databaseTime(value: string | null): Date | null {
    if (!value) return null;
    const [hour, minute] = value.split(':').map(Number);
    return new Date(Date.UTC(1970, 0, 1, hour, minute, 0));
  }

  private minuteOfDay(value: string): number {
    const [hour, minute] = value.split(':').map(Number);
    return hour * 60 + minute;
  }

  private normalizeCountryCode(value: string | undefined): string | null {
    const normalized = value?.trim().toUpperCase();
    if (!normalized) return null;
    if (!/^[A-Z]{2}$/.test(normalized)) {
      throw new BadRequestException(
        'Country code must use a two-letter ISO country code.',
      );
    }
    return normalized;
  }

  private normalizeOptionalText(value: string | undefined): string | null {
    const normalized = value?.trim();
    return normalized ? normalized : null;
  }
}
