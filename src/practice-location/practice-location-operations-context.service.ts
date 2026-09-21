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
      select: {
        id: true,
        name: true,
        timeZone: true,
        doctorProfile: { select: { userId: true } },
        staffAssignments: {
          where: { userId, isActive: true, disconnectedAt: null },
          select: {
            authorityBundles: {
              where: { status: 'ACTIVE' },
              select: { id: true },
            },
            substituteSecretaryCoverages: {
              where: { status: 'ACTIVE' },
              orderBy: { fromServiceDate: 'asc' },
              select: { fromServiceDate: true, toServiceDate: true },
            },
          },
        },
      },
    });

    if (!location) {
      throw new NotFoundException('Practice location was not found.');
    }
    if (!location.timeZone) {
      throw new ConflictException(
        'Practice location time zone is not configured.',
      );
    }

    const currentServiceDate = this.dateInTimeZone(
      new Date(),
      location.timeZone,
    );
    const unrestricted =
      location.doctorProfile.userId === userId ||
      location.staffAssignments.some(
        (staff) => staff.authorityBundles.length > 0,
      );
    const allowedServiceDateRanges = unrestricted
      ? null
      : location.staffAssignments
          .flatMap((staff) =>
            staff.substituteSecretaryCoverages.map((coverage) => ({
              fromServiceDate: coverage.fromServiceDate
                .toISOString()
                .slice(0, 10),
              toServiceDate: coverage.toServiceDate.toISOString().slice(0, 10),
            })),
          )
          .sort((a, b) => a.fromServiceDate.localeCompare(b.fromServiceDate));
    const defaultServiceDate =
      allowedServiceDateRanges === null ||
      allowedServiceDateRanges.some(
        (range) =>
          range.fromServiceDate <= currentServiceDate &&
          range.toServiceDate >= currentServiceDate,
      )
        ? currentServiceDate
        : (allowedServiceDateRanges.find(
            (range) => range.fromServiceDate > currentServiceDate,
          )?.fromServiceDate ??
          allowedServiceDateRanges.at(-1)?.toServiceDate ??
          null);
    return {
      allowedServiceDateRanges,
      defaultServiceDate,
      practiceLocationId: location.id,
      clinicName: location.name,
      timeZone: location.timeZone,
      currentServiceDate,
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
