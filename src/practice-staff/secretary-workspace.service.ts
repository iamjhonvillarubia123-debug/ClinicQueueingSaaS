import { ForbiddenException, Injectable } from '@nestjs/common';
import { UserRole } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class SecretaryWorkspaceService {
  constructor(private readonly prisma: PrismaService) {}

  async getWorkspace(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, role: true },
    });
    if (!user || user.role !== UserRole.SECRETARY)
      throw new ForbiddenException('Secretary workspace access is required.');

    const [assignments, invitations] = await Promise.all([
      this.prisma.practiceStaff.findMany({
        where: { userId, disconnectedAt: null },
        orderBy: { activatedAt: 'desc' },
        select: {
          id: true,
          isActive: true,
          activatedAt: true,
          practiceLocation: {
            select: {
              id: true,
              name: true,
              addressLine1: true,
              addressLine2: true,
              cityMunicipality: true,
              province: true,
              timeZone: true,
              currentRegularPracticeStaffId: true,
              doctorProfile: {
                select: {
                  user: { select: { firstName: true, lastName: true } },
                },
              },
            },
          },
          authorityBundles: {
            where: { status: 'ACTIVE' },
            select: { bundleType: true },
          },
          substituteSecretaryCoverages: {
            where: { status: 'ACTIVE' },
            orderBy: { fromServiceDate: 'asc' },
            select: {
              id: true,
              coverageMode: true,
              fromServiceDate: true,
              toServiceDate: true,
            },
          },
        },
      }),
      this.prisma.secretaryInvitation.findMany({
        where: {
          normalizedEmail: user.email.trim().toLowerCase(),
          status: 'PENDING',
          expiresAt: { gt: new Date() },
        },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          requestedAssignmentType: true,
          requestedAuthorityBundles: true,
          requestedCancelClinicDay: true,
          requestedCoverageMode: true,
          requestedFromServiceDate: true,
          requestedToServiceDate: true,
          createdAt: true,
          expiresAt: true,
          practiceLocation: {
            select: {
              id: true,
              name: true,
              doctorProfile: {
                select: {
                  user: { select: { firstName: true, lastName: true } },
                },
              },
            },
          },
        },
      }),
    ]);

    return {
      clinics: assignments.map((assignment) => {
        const clinic = assignment.practiceLocation;
        const isClinicSecretary =
          clinic.currentRegularPracticeStaffId === assignment.id;
        const bundles = assignment.authorityBundles.map(
          ({ bundleType }) => bundleType,
        );
        return {
          practiceStaffId: assignment.id,
          clinicId: clinic.id,
          clinicName: clinic.name,
          address:
            [
              clinic.addressLine1,
              clinic.addressLine2,
              clinic.cityMunicipality,
              clinic.province,
            ]
              .filter(Boolean)
              .join(', ') || null,
          timeZone: clinic.timeZone ?? 'Asia/Manila',
          doctorName:
            `${clinic.doctorProfile.user.firstName} ${clinic.doctorProfile.user.lastName}`.trim(),
          status: assignment.isActive
            ? ('ACTIVE' as const)
            : ('DISABLED' as const),
          assignmentType: isClinicSecretary
            ? ('CLINIC_SECRETARY' as const)
            : ('SUBSTITUTE_SECRETARY' as const),
          authorityBundles: bundles,
          substituteCoverages: assignment.substituteSecretaryCoverages,
          assignedAt: assignment.activatedAt,
        };
      }),
      invitations: invitations.map((invitation) => ({
        invitationId: invitation.id,
        clinicId: invitation.practiceLocation.id,
        clinicName: invitation.practiceLocation.name,
        doctorName:
          `${invitation.practiceLocation.doctorProfile.user.firstName} ${invitation.practiceLocation.doctorProfile.user.lastName}`.trim(),
        assignmentType: invitation.requestedAssignmentType,
        authorityBundles: invitation.requestedAuthorityBundles,
        requestedCancelClinicDay: invitation.requestedCancelClinicDay,
        coverageMode: invitation.requestedCoverageMode,
        fromServiceDate: invitation.requestedFromServiceDate,
        toServiceDate: invitation.requestedToServiceDate,
        invitedAt: invitation.createdAt,
        expiresAt: invitation.expiresAt,
      })),
    };
  }
}
