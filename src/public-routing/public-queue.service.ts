import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { SubscriptionEntitlementService } from '../financial/subscription-entitlement.service';
import { PrismaService } from '../prisma/prisma.service';

export enum PublicQueueStatus {
  AVAILABLE = 'AVAILABLE',
  TEMPORARILY_UNAVAILABLE = 'TEMPORARILY_UNAVAILABLE',
}

type QueueNumberRow = {
  queueNumber: number;
};

@Injectable()
export class PublicQueueService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly subscriptionEntitlement: SubscriptionEntitlementService,
  ) {}

  async getPublicQueue(
    publicIdentifier: string,
    serviceDate: string,
    now = new Date(),
  ) {
    const normalizedIdentifier = this.normalizeIdentifier(publicIdentifier);
    const dateValue = this.parseServiceDate(serviceDate);
    const location = await this.prisma.practiceLocation.findUnique({
      where: { publicIdentifier: normalizedIdentifier },
      select: {
        id: true,
        publicIdentifier: true,
        lifecycleStatus: true,
        name: true,
        doctorProfile: {
          select: {
            user: {
              select: {
                accountStatus: true,
                administrativeRestrictionStatus: true,
                doctorFinancialAccount: { select: { id: true } },
              },
            },
          },
        },
      },
    });

    if (!location) this.notFound();
    if (location.lifecycleStatus === 'PERMANENTLY_DELETED') this.notFound();
    if (location.doctorProfile.user.accountStatus === 'PERMANENTLY_CLOSED') {
      this.notFound();
    }

    const subscriptionAllowsPublicQueue =
      await this.subscriptionAllowsPublicQueue(
        location.doctorProfile.user.doctorFinancialAccount?.id,
        now,
      );
    const publicQueueAllowed =
      location.lifecycleStatus === 'ACTIVE' &&
      location.doctorProfile.user.accountStatus === 'ACTIVE' &&
      location.doctorProfile.user.administrativeRestrictionStatus === 'NONE' &&
      subscriptionAllowsPublicQueue;

    if (!publicQueueAllowed) {
      return {
        publicIdentifier: location.publicIdentifier,
        practiceLocationName: location.name,
        serviceDate,
        status: PublicQueueStatus.TEMPORARILY_UNAVAILABLE,
        message:
          'The online queue display is temporarily unavailable. Please try again later.',
        clinicDayStatus: null,
        nowServingQueueNumber: null,
      };
    }

    const clinicDay = await this.prisma.clinicDay.findUnique({
      where: {
        practiceLocationId_serviceDate: {
          practiceLocationId: location.id,
          serviceDate: dateValue,
        },
      },
      select: { status: true },
    });

    if (clinicDay?.status === 'CLOSED') {
      return {
        publicIdentifier: location.publicIdentifier,
        practiceLocationName: location.name,
        serviceDate,
        status: PublicQueueStatus.AVAILABLE,
        message: "TODAY'S QUEUE HAS ENDED",
        clinicDayStatus: clinicDay.status,
        nowServingQueueNumber: null,
      };
    }

    const nowServingRows = await this.prisma.$queryRaw<QueueNumberRow[]>(
      Prisma.sql`
        SELECT "queueNumber"
        FROM "Appointment"
        WHERE "practiceLocationId" = ${location.id}
          AND "serviceDate" = ${dateValue}
          AND "status" = 'CALLED'::"AppointmentStatus"
        ORDER BY "calledAt" DESC NULLS LAST, "queueNumber" ASC, "id" ASC
        LIMIT 1
      `,
    );

    return {
      publicIdentifier: location.publicIdentifier,
      practiceLocationName: location.name,
      serviceDate,
      status: PublicQueueStatus.AVAILABLE,
      message: null,
      clinicDayStatus: clinicDay?.status ?? null,
      nowServingQueueNumber: nowServingRows[0]?.queueNumber ?? null,
    };
  }

  private async subscriptionAllowsPublicQueue(
    doctorFinancialAccountId: string | undefined,
    now: Date,
  ): Promise<boolean> {
    if (!doctorFinancialAccountId) return false;
    const evaluation =
      await this.subscriptionEntitlement.evaluateForFinancialAccount(
        doctorFinancialAccountId,
        now,
      );
    return evaluation.allowsNewSubscriptionGatedActivity;
  }

  private parseServiceDate(serviceDate: string): Date {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(serviceDate)) this.notFound();
    const [year, month, day] = serviceDate.split('-').map(Number);
    const dateValue = new Date(Date.UTC(year, month - 1, day));
    if (
      dateValue.getUTCFullYear() !== year ||
      dateValue.getUTCMonth() !== month - 1 ||
      dateValue.getUTCDate() !== day
    ) {
      this.notFound();
    }
    return dateValue;
  }

  private normalizeIdentifier(publicIdentifier: string): string {
    const normalized = publicIdentifier.trim();
    if (!normalized || normalized.length > 64) this.notFound();
    return normalized;
  }

  private notFound(): never {
    throw new NotFoundException('Public queue route not found.');
  }
}
