import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PracticeLocationLifecycleStatus, Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RecurringScheduleConflictService } from '../schedule/recurring-schedule-conflict.service';
import { ValidatePracticeScheduleDto } from './dto/validate-practice-schedule.dto';

class SuccessfulPreflightRollback extends Error {}

@Injectable()
export class PracticeSchedulePreflightService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly recurringConflict: RecurringScheduleConflictService,
  ) {}

  async validate(userId: string, dto: ValidatePracticeScheduleDto) {
    const doctorProfile = await this.prisma.doctorProfile.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!doctorProfile) {
      throw new ForbiddenException('Only a doctor may validate clinic hours.');
    }

    const timeZone = dto.timeZone.trim();
    if (!timeZone) {
      throw new ConflictException('Practice location time zone is required.');
    }

    const requestedLocationId = dto.practiceLocationId;
    if (requestedLocationId) {
      const owned = await this.prisma.practiceLocation.findFirst({
        where: { id: requestedLocationId, doctorProfileId: doctorProfile.id },
        select: { id: true, lifecycleStatus: true },
      });
      if (!owned || owned.lifecycleStatus === PracticeLocationLifecycleStatus.PERMANENTLY_DELETED) {
        throw new NotFoundException('Practice location not found.');
      }
    }

    try {
      await this.prisma.$transaction(async (tx) => {
        let candidateLocationId = requestedLocationId;
        if (!candidateLocationId) {
          const temporary = await tx.practiceLocation.create({
            data: {
              doctorProfileId: doctorProfile.id,
              lifecycleStatus: PracticeLocationLifecycleStatus.DRAFT,
              timeZone,
            },
            select: { id: true },
          });
          candidateLocationId = temporary.id;
        }

        await tx.practiceSchedule.deleteMany({
          where: { practiceLocationId: candidateLocationId },
        });

        for (const schedule of dto.schedules) {
          if (schedule.isOpen && (!schedule.opensAtLocal || !schedule.closesAtLocal)) {
            throw new ConflictException(
              `Opening and closing times are required for ${schedule.weekday.toLowerCase()}.`,
            );
          }

          await tx.practiceSchedule.create({
            data: {
              practiceLocationId: candidateLocationId,
              weekday: schedule.weekday,
              isOpen: schedule.isOpen,
              opensAtLocal: schedule.isOpen ? this.localTime(schedule.opensAtLocal!) : null,
              closesAtLocal: schedule.isOpen ? this.localTime(schedule.closesAtLocal!) : null,
            },
          });
        }

        await this.recurringConflict.assertNoConflictForLocation(
          doctorProfile.id,
          candidateLocationId,
          timeZone,
          tx as Prisma.TransactionClient,
        );

        throw new SuccessfulPreflightRollback();
      });
    } catch (error) {
      if (error instanceof SuccessfulPreflightRollback) {
        return { valid: true };
      }
      throw error;
    }

    return { valid: true };
  }

  private localTime(value: string): Date {
    const [hours, minutes] = value.split(':').map(Number);
    return new Date(Date.UTC(1970, 0, 1, hours, minutes, 0, 0));
  }
}
