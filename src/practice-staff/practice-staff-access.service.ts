import { createHash } from 'crypto';
import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  PracticeStaffCapabilityStatus,
  PracticeStaffCapabilityType,
  SecretaryAccessProfile,
} from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigureSecretaryAccessDto } from './dto/configure-secretary-access.dto';

@Injectable()
export class PracticeStaffAccessService {
  constructor(private readonly prisma: PrismaService) {}

  async configure(authenticatedUserId: string, dto: ConfigureSecretaryAccessDto) {
    return this.prisma.$transaction(async (transaction) => {
      const location = await transaction.practiceLocation.findFirst({
        where: { id: dto.practiceLocationId, doctorProfile: { userId: authenticatedUserId } },
        select: { id: true, currentRegularPracticeStaffId: true },
      });
      if (!location) throw new ForbiddenException('Only the owning Doctor may configure Secretary access.');
      if (!location.currentRegularPracticeStaffId) throw new ConflictException('This clinic has no current regular Secretary.');

      const assignment = await transaction.practiceStaff.findFirst({
        where: {
          id: location.currentRegularPracticeStaffId,
          userId: dto.userId,
          practiceLocationId: location.id,
          isActive: true,
        },
        select: { id: true },
      });
      if (!assignment) throw new NotFoundException('The selected Secretary is not the current regular Secretary for this clinic.');

      const flags = this.normalizeFlags(dto);
      await transaction.practiceStaff.update({
        where: { id: assignment.id },
        data: {
          accessProfile: dto.accessProfile,
          canManageClinicDetails: flags.canManageClinicDetails,
          canManageServices: flags.canManageServices,
          canManageBookingQuestions: flags.canManageBookingQuestions,
          canManageSchedules: flags.canManageSchedules,
        },
      });

      await this.reconcileCapability(
        transaction,
        assignment.id,
        authenticatedUserId,
        PracticeStaffCapabilityType.CANCEL_CLINIC_DAY,
        Boolean(dto.cancelClinicDay),
      );
      await this.reconcileCapability(
        transaction,
        assignment.id,
        authenticatedUserId,
        PracticeStaffCapabilityType.ASSIGN_DAY_SECRETARY,
        Boolean(dto.assignDaySecretary),
      );

      return { configured: true, accessProfile: dto.accessProfile, ...flags };
    });
  }

  private normalizeFlags(dto: ConfigureSecretaryAccessDto) {
    if (dto.accessProfile === SecretaryAccessProfile.STANDARD) {
      return {
        canManageClinicDetails: false,
        canManageServices: false,
        canManageBookingQuestions: false,
        canManageSchedules: false,
      };
    }
    if (dto.accessProfile === SecretaryAccessProfile.FULL_CLINIC_CONFIGURATION) {
      return {
        canManageClinicDetails: true,
        canManageServices: true,
        canManageBookingQuestions: true,
        canManageSchedules: true,
      };
    }
    return {
      canManageClinicDetails: Boolean(dto.canManageClinicDetails),
      canManageServices: Boolean(dto.canManageServices),
      canManageBookingQuestions: Boolean(dto.canManageBookingQuestions),
      canManageSchedules: Boolean(dto.canManageSchedules),
    };
  }

  private async reconcileCapability(
    transaction: Parameters<Parameters<PrismaService['$transaction']>[0]>[0],
    practiceStaffId: string,
    doctorUserId: string,
    capabilityType: PracticeStaffCapabilityType,
    desired: boolean,
  ) {
    const active = await transaction.practiceStaffCapability.findFirst({
      where: { practiceStaffId, capabilityType, status: PracticeStaffCapabilityStatus.ACTIVE },
      select: { id: true },
    });
    const now = new Date();
    if (desired && !active) {
      await transaction.practiceStaffCapability.create({
        data: {
          practiceStaffId,
          capabilityType,
          status: PracticeStaffCapabilityStatus.ACTIVE,
          activeCapabilityKey: this.hash(`PRACTICE_STAFF_CAPABILITY|${practiceStaffId}|${capabilityType}`),
          grantedByUserId: doctorUserId,
          grantedAt: now,
        },
      });
      return;
    }
    if (!desired && active) {
      await transaction.practiceStaffCapability.update({
        where: { id: active.id },
        data: {
          status: PracticeStaffCapabilityStatus.REVOKED,
          activeCapabilityKey: null,
          revokedByUserId: doctorUserId,
          revokedAt: now,
        },
      });
    }
  }

  private hash(value: string) {
    return createHash('sha256').update(value, 'utf8').digest('hex');
  }
}
