import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { AppointmentStatus, ClinicDayStatus, PracticeLocationLifecycleStatus } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PracticeLocationOperationsService } from './practice-location-operations.service';

describe('PracticeLocationOperationsService', () => {
  const prisma = {
    doctorProfile: { findUnique: jest.fn() },
    practiceLocation: { findFirst: jest.fn() },
    appointment: { findMany: jest.fn() },
    queueEvent: { findMany: jest.fn() },
  };
  const service = new PracticeLocationOperationsService(prisma as unknown as PrismaService);

  beforeEach(() => jest.clearAllMocks());

  it('rejects an invalid service date before reading data', async () => {
    await expect(service.getOverview('doctor-1', 'clinic-1', '08/25/2026')).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.doctorProfile.findUnique).not.toHaveBeenCalled();
  });

  it('requires an authenticated doctor profile', async () => {
    prisma.doctorProfile.findUnique.mockResolvedValue(null);
    await expect(service.getOverview('secretary-1', 'clinic-1', '2026-08-25')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('does not disclose a clinic outside the doctor ownership scope', async () => {
    prisma.doctorProfile.findUnique.mockResolvedValue({ id: 'doctor-profile-1' });
    prisma.practiceLocation.findFirst.mockResolvedValue(null);
    await expect(service.getOverview('doctor-1', 'clinic-2', '2026-08-25')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('builds the overview from authoritative clinic-day and appointment state', async () => {
    prisma.doctorProfile.findUnique.mockResolvedValue({ id: 'doctor-profile-1' });
    prisma.practiceLocation.findFirst.mockResolvedValue({
      id: 'clinic-1', name: 'North Clinic', addressLine1: '123 Health St.', cityMunicipality: 'Davao City', province: null,
      countryCode: 'PH', timeZone: 'Asia/Manila', lifecycleStatus: PracticeLocationLifecycleStatus.ACTIVE,
      doctorProfile: { professionalTitle: 'Dr.', user: { firstName: 'Juan', lastName: 'Dela Cruz' } },
      practiceSchedules: [{ isOpen: true, opensAtLocal: new Date('1970-01-01T08:00:00.000Z'), closesAtLocal: new Date('1970-01-01T17:00:00.000Z') }],
      clinicDays: [{ id: 'day-1', status: ClinicDayStatus.STARTED, openingOverrideAt: null, startedAt: new Date('2026-08-25T00:00:00.000Z'), closedAt: null, operatingPracticeStaff: { id: 'staff-1', user: { id: 'secretary-1', firstName: 'Maria', lastName: 'Santos' } } }],
    });
    prisma.appointment.findMany.mockResolvedValue([
      { id: 'a1', bookingReference: 'APP-1', queueNumber: 1, firstName: 'Ana', lastName: 'Garcia', status: AppointmentStatus.CALLED, estimatedServiceMinutes: 15, calledAt: new Date(), completedAt: null, createdAt: new Date(), bookedServices: [{ serviceNameSnapshot: 'Consultation' }] },
      { id: 'a2', bookingReference: 'APP-2', queueNumber: 2, firstName: 'Pedro', lastName: 'Reyes', status: AppointmentStatus.WAITING, estimatedServiceMinutes: 20, calledAt: null, completedAt: null, createdAt: new Date(), bookedServices: [{ serviceNameSnapshot: 'Dental Cleaning' }] },
    ]);
    prisma.queueEvent.findMany.mockResolvedValue([]);

    const result = await service.getOverview('doctor-1', 'clinic-1', '2026-08-25');
    expect(result.clinic.doctorName).toBe('Dr. Juan Dela Cruz');
    expect(result.schedule).toEqual({ isOpen: true, opensAt: '08:00', closesAt: '17:00' });
    expect(result.queue.waitingCount).toBe(1);
    expect(result.queue.nowServing?.queueNumber).toBe(1);
    expect(result.queue.next?.queueNumber).toBe(2);
    expect(result.clinicDay?.operatingSecretary?.name).toBe('Maria Santos');
  });
});
