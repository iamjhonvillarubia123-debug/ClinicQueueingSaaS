import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PracticeLocationStaffReadService {
  constructor(private readonly prisma: PrismaService) {}

  async getClinicStaff(userId: string, practiceLocationId: string) {
    const location = await this.prisma.practiceLocation.findFirst({
      where: { id: practiceLocationId, doctorProfile: { userId } },
      select: {
        id: true,
        name: true,
        currentRegularPracticeStaffId: true,
        staffAssignments: {
          orderBy: [{ isActive: 'desc' }, { activatedAt: 'asc' }],
          select: {
            id: true,
            staffRole: true,
            isActive: true,
            activatedAt: true,
            deactivatedAt: true,
            updatedAt: true,
            user: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
                mobileNumber: true,
                role: true,
                accountStatus: true,
                emailVerifiedAt: true,
              },
            },
            authorityBundles: {
              where: { status: 'ACTIVE' },
              orderBy: { grantedAt: 'asc' },
              select: { bundleType: true },
            },
            substituteSecretaryCoverages: {
              orderBy: { createdAt: 'desc' },
              select: {
                id: true,
                coverageMode: true,
                fromServiceDate: true,
                toServiceDate: true,
                status: true,
                createdAt: true,
                endedAt: true,
              },
            },
          },
        },
        secretaryInvitations: {
          where: { status: 'PENDING' },
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            firstName: true,
            lastName: true,
            normalizedEmail: true,
            mobileNumber: true,
            status: true,
            expiresAt: true,
            createdAt: true,
          },
        },
      },
    });

    if (!location) {
      throw new NotFoundException('Practice location was not found.');
    }

    const candidates = await this.prisma.user.findMany({
      where: {
        role: 'SECRETARY',
        accountStatus: 'ACTIVE',
        emailVerifiedAt: { not: null },
        OR: [
          {
            practiceStaffAssignments: {
              some: { practiceLocation: { doctorProfile: { userId } } },
            },
          },
          { secretaryInvitationAccepted: { practiceLocationId } },
        ],
      },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        mobileNumber: true,
      },
    });

    return {
      clinic: { id: location.id, name: location.name },
      staffAssignments: location.staffAssignments.map((assignment) => ({
        practiceStaffId: assignment.id,
        userId: assignment.user.id,
        name: `${assignment.user.firstName} ${assignment.user.lastName}`.trim(),
        email: assignment.user.email,
        mobileNumber: assignment.user.mobileNumber,
        assignmentActive: assignment.isActive,
        operationallyReady:
          assignment.isActive &&
          assignment.staffRole === 'SECRETARY' &&
          assignment.user.role === 'SECRETARY' &&
          assignment.user.accountStatus === 'ACTIVE' &&
          assignment.user.emailVerifiedAt !== null,
        isClinicSecretary:
          assignment.id === location.currentRegularPracticeStaffId,
        assignedAt: assignment.activatedAt,
        deactivatedAt: assignment.deactivatedAt,
        updatedAt: assignment.updatedAt,
        authorityBundles: assignment.authorityBundles.map(
          ({ bundleType }) => bundleType,
        ),
        substituteCoverages: assignment.substituteSecretaryCoverages,
      })),
      candidates: candidates.map((candidate) => ({
        userId: candidate.id,
        name: `${candidate.firstName} ${candidate.lastName}`.trim(),
        email: candidate.email,
        mobileNumber: candidate.mobileNumber,
      })),
      pendingInvitations: location.secretaryInvitations.map((invitation) => ({
        invitationId: invitation.id,
        name: `${invitation.firstName} ${invitation.lastName}`.trim(),
        email: invitation.normalizedEmail,
        mobileNumber: invitation.mobileNumber,
        status: invitation.status,
        invitedAt: invitation.createdAt,
        expiresAt: invitation.expiresAt,
      })),
    };
  }

  async getStaff(
    userId: string,
    practiceLocationId: string,
    serviceDateInput: string,
  ) {
    const serviceDate = this.parseServiceDate(serviceDateInput);
    const location = await this.prisma.practiceLocation.findFirst({
      where: { id: practiceLocationId, doctorProfile: { userId } },
      select: {
        id: true,
        name: true,
        currentRegularPracticeStaffId: true,
        currentRegularPracticeStaff: {
          select: {
            id: true,
            staffRole: true,
            isActive: true,
            createdAt: true,
            updatedAt: true,
            user: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
                role: true,
                accountStatus: true,
                emailVerifiedAt: true,
              },
            },
          },
        },
        staffAssignments: {
          orderBy: [{ isActive: 'desc' }, { createdAt: 'asc' }],
          select: {
            id: true,
            staffRole: true,
            isActive: true,
            createdAt: true,
            updatedAt: true,
            user: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
                role: true,
                accountStatus: true,
                emailVerifiedAt: true,
              },
            },
          },
        },
        clinicDays: {
          where: { serviceDate },
          take: 1,
          select: {
            id: true,
            status: true,
            operatingPracticeStaffId: true,
            operatingPracticeStaff: {
              select: {
                id: true,
                staffRole: true,
                isActive: true,
                createdAt: true,
                updatedAt: true,
                user: {
                  select: {
                    id: true,
                    firstName: true,
                    lastName: true,
                    email: true,
                    role: true,
                    accountStatus: true,
                    emailVerifiedAt: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!location) {
      throw new NotFoundException('Practice location was not found.');
    }

    const clinicDay = location.clinicDays[0] ?? null;
    return {
      clinic: { id: location.id, name: location.name },
      serviceDate: serviceDateInput,
      regularSecretary: location.currentRegularPracticeStaff
        ? this.toStaff(location.currentRegularPracticeStaff)
        : null,
      operatingSecretary: clinicDay?.operatingPracticeStaff
        ? this.toStaff(clinicDay.operatingPracticeStaff)
        : null,
      clinicDay: clinicDay
        ? {
            id: clinicDay.id,
            status: clinicDay.status,
            operatingPracticeStaffId: clinicDay.operatingPracticeStaffId,
          }
        : null,
      staffAssignments: location.staffAssignments.map((assignment) => ({
        ...this.toStaff(assignment),
        isRegular: assignment.id === location.currentRegularPracticeStaffId,
        isOperating: assignment.id === clinicDay?.operatingPracticeStaffId,
      })),
    };
  }

  private toStaff(staff: {
    id: string;
    staffRole: string;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
    user: {
      id: string;
      firstName: string;
      lastName: string;
      email: string;
      role: string;
      accountStatus: string;
      emailVerifiedAt: Date | null;
    };
  }) {
    return {
      practiceStaffId: staff.id,
      userId: staff.user.id,
      name: `${staff.user.firstName} ${staff.user.lastName}`.trim(),
      email: staff.user.email,
      staffRole: staff.staffRole,
      assignmentActive: staff.isActive,
      userRole: staff.user.role,
      accountStatus: staff.user.accountStatus,
      operationallyReady:
        staff.isActive &&
        staff.staffRole === 'SECRETARY' &&
        staff.user.role === 'SECRETARY' &&
        staff.user.accountStatus === 'ACTIVE' &&
        staff.user.emailVerifiedAt !== null,
      assignedAt: staff.createdAt,
      updatedAt: staff.updatedAt,
    };
  }

  private parseServiceDate(value: string): Date {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? '')) {
      throw new BadRequestException('serviceDate must use YYYY-MM-DD.');
    }
    const date = new Date(`${value}T00:00:00.000Z`);
    if (
      Number.isNaN(date.getTime()) ||
      date.toISOString().slice(0, 10) !== value
    ) {
      throw new BadRequestException('serviceDate is invalid.');
    }
    return date;
  }
}
