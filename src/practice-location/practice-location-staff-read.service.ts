import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PracticeLocationStaffReadService {
  constructor(private readonly prisma: PrismaService) {}

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
        isRegular:
          assignment.id === location.currentRegularPracticeStaffId,
        isOperating:
          assignment.id === clinicDay?.operatingPracticeStaffId,
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
