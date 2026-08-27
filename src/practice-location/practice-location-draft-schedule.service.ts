import {
  BadRequestException,
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
import { SaveDraftPracticeScheduleDto } from './dto/save-draft-practice-schedule.dto';

@Injectable()
export class PracticeLocationDraftScheduleService {
  constructor(private readonly prisma: PrismaService) {}

  async replaceDraftSchedule(
    userId: string,
    practiceLocationId: string,
    dto: SaveDraftPracticeScheduleDto,
  ) {
    const doctorProfile = await this.prisma.doctorProfile.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!doctorProfile) {
      throw new ForbiddenException('Only a doctor may save clinic hours.');
    }

    const weekdays = new Set(dto.schedules.map((row) => row.weekday));
    if (
      weekdays.size !== Object.values(Weekday).length ||
      Object.values(Weekday).some((weekday) => !weekdays.has(weekday))
    ) {
      throw new BadRequestException(
        'Draft clinic hours must contain each weekday exactly once.',
      );
    }

    for (const row of dto.schedules) {
      if (!row.isOpen) continue;
      if (!row.opensAtLocal || !row.closesAtLocal) {
        throw new BadRequestException(
          `Opening and closing times are required for ${row.weekday.toLowerCase()}.`,
        );
      }
      const opens = this.minutes(row.opensAtLocal);
      const closes = this.minutes(row.closesAtLocal);
      if (opens >= closes) {
        throw new BadRequestException(
          `Closing time must be later than opening time for ${row.weekday.toLowerCase()}.`,
        );
      }
      if (row.maximumOnlineBookingUntilLocal) {
        const cutoff = this.minutes(row.maximumOnlineBookingUntilLocal);
        if (cutoff < opens || cutoff > closes) {
          throw new BadRequestException(
            `Online booking cutoff must fall within clinic hours for ${row.weekday.toLowerCase()}.`,
          );
        }
      }
    }

    return this.prisma.$transaction(
      async (transaction) => {
        const location = await transaction.practiceLocation.findFirst({
          where: {
            id: practiceLocationId,
            doctorProfileId: doctorProfile.id,
          },
          select: { id: true, lifecycleStatus: true },
        });
        if (!location) {
          throw new NotFoundException('Practice location not found.');
        }
        const rows = dto.schedules.map((row) => ({
          weekday: row.weekday,
          isOpen: row.isOpen,
          opensAtLocal: row.isOpen ? this.localTime(row.opensAtLocal!) : null,
          closesAtLocal: row.isOpen ? this.localTime(row.closesAtLocal!) : null,
          maximumOnlineBookingUntilLocal:
            row.isOpen && row.maximumOnlineBookingUntilLocal
              ? this.localTime(row.maximumOnlineBookingUntilLocal)
              : null,
          maximumOperatingUntilLocal:
            row.isOpen && row.maximumOperatingUntilLocal
              ? this.localTime(row.maximumOperatingUntilLocal)
              : null,
        }));

        if (
          location.lifecycleStatus === PracticeLocationLifecycleStatus.DRAFT
        ) {
          for (const row of rows) {
            const { weekday, ...data } = row;
            await transaction.practiceSchedule.upsert({
              where: {
                practiceLocationId_weekday: {
                  practiceLocationId,
                  weekday,
                },
              },
              create: { practiceLocationId, weekday, ...data },
              update: data,
            });
          }

          return transaction.practiceSchedule.findMany({
            where: { practiceLocationId },
            orderBy: { weekday: 'asc' },
          });
        }

        const draft = await transaction.doctorPracticeScheduleDraft.upsert({
          where: { practiceLocationId },
          create: { practiceLocationId },
          update: {},
          select: { id: true },
        });
        await transaction.doctorPracticeScheduleDraftRow.deleteMany({
          where: { doctorPracticeScheduleDraftId: draft.id },
        });
        await transaction.doctorPracticeScheduleDraftRow.createMany({
          data: rows.map((row) => ({
            doctorPracticeScheduleDraftId: draft.id,
            ...row,
          })),
        });

        return transaction.doctorPracticeScheduleDraftRow.findMany({
          where: { doctorPracticeScheduleDraftId: draft.id },
          orderBy: { weekday: 'asc' },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  private minutes(value: string): number {
    const [hours, minutes] = value.split(':').map(Number);
    return hours * 60 + minutes;
  }

  private localTime(value: string): Date {
    const [hours, minutes] = value.split(':').map(Number);
    return new Date(Date.UTC(1970, 0, 1, hours, minutes, 0, 0));
  }
}
