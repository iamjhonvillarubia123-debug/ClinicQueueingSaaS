import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AppointmentStatus,
  RetentionHoldReasonCategory,
  RetentionResourceType,
  UserAccountStatus,
  UserRole,
} from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const APPOINTMENT_ERASURE_DELAY_MS = 24 * 60 * 60 * 1000;

export type AppointmentErasureEligibility = {
  appointmentId: string;
  eligible: boolean;
  reason:
    | 'ELIGIBLE'
    | 'NOT_TERMINAL'
    | 'RETENTION_WINDOW_ACTIVE'
    | 'ACTIVE_RETENTION_HOLD';
  terminalAt: Date | null;
  eligibleAt: Date | null;
};

@Injectable()
export class PrivacyRetentionService {
  constructor(private readonly prisma: PrismaService) {}

  async evaluateAppointmentErasureEligibility(
    appointmentId: string,
    now = new Date(),
  ): Promise<AppointmentErasureEligibility> {
    const appointment = await this.prisma.appointment.findUnique({
      where: { id: appointmentId },
      select: { id: true, status: true, terminalAt: true },
    });

    if (!appointment) {
      throw new NotFoundException('Appointment not found.');
    }

    if (!appointment.terminalAt || !this.isTerminalStatus(appointment.status)) {
      return {
        appointmentId,
        eligible: false,
        reason: 'NOT_TERMINAL',
        terminalAt: appointment.terminalAt,
        eligibleAt: null,
      };
    }

    const eligibleAt = new Date(
      appointment.terminalAt.getTime() + APPOINTMENT_ERASURE_DELAY_MS,
    );

    if (now.getTime() < eligibleAt.getTime()) {
      return {
        appointmentId,
        eligible: false,
        reason: 'RETENTION_WINDOW_ACTIVE',
        terminalAt: appointment.terminalAt,
        eligibleAt,
      };
    }

    const activeHold = await this.prisma.retentionHold.findFirst({
      where: {
        resourceType: RetentionResourceType.APPOINTMENT,
        resourceId: appointmentId,
        releasedAt: null,
        expiresAt: { gt: now },
      },
      select: { id: true },
    });

    if (activeHold) {
      return {
        appointmentId,
        eligible: false,
        reason: 'ACTIVE_RETENTION_HOLD',
        terminalAt: appointment.terminalAt,
        eligibleAt,
      };
    }

    return {
      appointmentId,
      eligible: true,
      reason: 'ELIGIBLE',
      terminalAt: appointment.terminalAt,
      eligibleAt,
    };
  }

  async createAppointmentRetentionHold(input: {
    appointmentId: string;
    createdByUserId: string;
    reasonCategory: RetentionHoldReasonCategory;
    explanation: string;
    reference?: string | null;
    reviewAt: Date;
    expiresAt: Date;
    now?: Date;
  }) {
    const now = input.now ?? new Date();
    const explanation = input.explanation.trim();
    const reference = input.reference?.trim() || null;

    if (!explanation) {
      throw new BadRequestException('Retention hold explanation is required.');
    }
    if (input.expiresAt.getTime() <= now.getTime()) {
      throw new BadRequestException('Retention hold expiry must be in the future.');
    }
    if (input.reviewAt.getTime() > input.expiresAt.getTime()) {
      throw new BadRequestException('Retention hold review must not be after expiry.');
    }

    return this.prisma.$transaction(async (transaction) => {
      const admin = await transaction.user.findUnique({
        where: { id: input.createdByUserId },
        select: { role: true, accountStatus: true },
      });
      if (
        !admin ||
        admin.role !== UserRole.SYSTEM_ADMIN ||
        admin.accountStatus !== UserAccountStatus.ACTIVE
      ) {
        throw new ForbiddenException('Active SYSTEM_ADMIN authority is required.');
      }

      const appointment = await transaction.appointment.findUnique({
        where: { id: input.appointmentId },
        select: { id: true },
      });
      if (!appointment) {
        throw new NotFoundException('Appointment not found.');
      }

      return transaction.retentionHold.create({
        data: {
          resourceType: RetentionResourceType.APPOINTMENT,
          resourceId: input.appointmentId,
          reasonCategory: input.reasonCategory,
          reference,
          explanation,
          createdByUserId: input.createdByUserId,
          createdAt: now,
          reviewAt: input.reviewAt,
          expiresAt: input.expiresAt,
        },
      });
    });
  }

  async releaseRetentionHold(
    retentionHoldId: string,
    releasedByUserId: string,
    now = new Date(),
  ) {
    return this.prisma.$transaction(async (transaction) => {
      const admin = await transaction.user.findUnique({
        where: { id: releasedByUserId },
        select: { role: true, accountStatus: true },
      });
      if (
        !admin ||
        admin.role !== UserRole.SYSTEM_ADMIN ||
        admin.accountStatus !== UserAccountStatus.ACTIVE
      ) {
        throw new ForbiddenException('Active SYSTEM_ADMIN authority is required.');
      }

      const hold = await transaction.retentionHold.findUnique({
        where: { id: retentionHoldId },
        select: { id: true, releasedAt: true },
      });
      if (!hold) {
        throw new NotFoundException('Retention hold not found.');
      }
      if (hold.releasedAt) return hold;

      return transaction.retentionHold.update({
        where: { id: retentionHoldId },
        data: { releasedAt: now },
      });
    });
  }

  private isTerminalStatus(status: AppointmentStatus): boolean {
    return [
      AppointmentStatus.COMPLETED,
      AppointmentStatus.EXPIRED,
      AppointmentStatus.CANCELLED,
      AppointmentStatus.NO_SHOW,
      AppointmentStatus.RESCHEDULED,
    ].includes(status);
  }
}
