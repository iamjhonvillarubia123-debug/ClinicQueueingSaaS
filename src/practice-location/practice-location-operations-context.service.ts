import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PracticeLocationOperationsContextService {
  constructor(private readonly prisma: PrismaService) {}

  async getContext(userId: string, practiceLocationId: string) {
    const location = await this.prisma.practiceLocation.findFirst({
      where: {
        id: practiceLocationId,
        OR: [
          { doctorProfile: { userId } },
          {
            staffAssignments: {
              some: {
                userId,
                isActive: true,
                disconnectedAt: null,
                OR: [
                  { authorityBundles: { some: { status: 'ACTIVE' } } },
                  {
                    substituteSecretaryCoverages: {
                      some: { status: 'ACTIVE' },
                    },
                  },
                ],
              },
            },
          },
        ],
      },
      select: { id: true, name: true, timeZone: true },
    });

    if (!location) {
      throw new NotFoundException('Practice location was not found.');
    }
    if (!location.timeZone) {
      throw new ConflictException(
        'Practice location time zone is not configured.',
      );
    }

    return {
      practiceLocationId: location.id,
      clinicName: location.name,
      timeZone: location.timeZone,
      currentServiceDate: this.dateInTimeZone(new Date(), location.timeZone),
    };
  }

  private dateInTimeZone(now: Date, timeZone: string) {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(now);
    const value = (type: Intl.DateTimeFormatPartTypes) =>
      parts.find((part) => part.type === type)?.value;
    const year = value('year');
    const month = value('month');
    const day = value('day');
    if (!year || !month || !day) {
      throw new ConflictException(
        'Unable to derive the clinic-local service date.',
      );
    }
    return `${year}-${month}-${day}`;
  }
}
