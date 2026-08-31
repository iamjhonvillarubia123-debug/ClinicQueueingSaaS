import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class SecretaryDirectoryService {
  constructor(private readonly prisma: PrismaService) {}
  async getDoctorDirectory(userId: string) {
    const clinics = await this.prisma.practiceLocation.findMany({
      where: { doctorProfile: { userId } },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        currentRegularPracticeStaffId: true,
        staffAssignments: {
          orderBy: [{ isActive: 'desc' }, { activatedAt: 'asc' }],
          select: {
            id: true,
            isActive: true,
            activatedAt: true,
            deactivatedAt: true,
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
            substituteSecretaryCoverages: {
              where: { status: 'ACTIVE' },
              select: {
                id: true,
                coverageMode: true,
                fromServiceDate: true,
                toServiceDate: true,
                status: true,
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
            requestedAssignmentType: true,
            requestedAuthorityBundles: true,
            requestedCoverageMode: true,
            requestedFromServiceDate: true,
            requestedToServiceDate: true,
            createdAt: true,
            expiresAt: true,
          },
        },
      },
    });
    return {
      assignments: clinics.flatMap((clinic) =>
        clinic.staffAssignments.map((staff) => ({
          practiceStaffId: staff.id,
          userId: staff.user.id,
          name: `${staff.user.firstName} ${staff.user.lastName}`.trim(),
          email: staff.user.email,
          mobileNumber: staff.user.mobileNumber,
          clinic: { id: clinic.id, name: clinic.name },
          assignmentActive: staff.isActive,
          operationallyReady:
            staff.isActive &&
            staff.user.role === 'SECRETARY' &&
            staff.user.accountStatus === 'ACTIVE' &&
            staff.user.emailVerifiedAt !== null,
          isClinicSecretary: staff.id === clinic.currentRegularPracticeStaffId,
          assignedAt: staff.activatedAt,
          deactivatedAt: staff.deactivatedAt,
          substituteCoverages: staff.substituteSecretaryCoverages,
        })),
      ),
      pendingInvitations: clinics.flatMap((clinic) =>
        clinic.secretaryInvitations.map((invitation) => ({
          invitationId: invitation.id,
          name: `${invitation.firstName} ${invitation.lastName}`.trim(),
          email: invitation.normalizedEmail,
          mobileNumber: invitation.mobileNumber,
          clinic: { id: clinic.id, name: clinic.name },
          status: invitation.status,
          assignmentType: invitation.requestedAssignmentType,
          authorityBundles: invitation.requestedAuthorityBundles,
          coverageMode: invitation.requestedCoverageMode,
          fromServiceDate: invitation.requestedFromServiceDate,
          toServiceDate: invitation.requestedToServiceDate,
          invitedAt: invitation.createdAt,
          expiresAt: invitation.expiresAt,
        })),
      ),
    };
  }
}
