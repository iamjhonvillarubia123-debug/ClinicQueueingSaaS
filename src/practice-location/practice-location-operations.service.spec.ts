import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  AppointmentStatus,
  ClinicDayStatus,
  PracticeLocationLifecycleStatus,
} from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MobileNumberService } from '../security/mobile-number/mobile-number.service';
import { PracticeLocationOperationsService } from './practice-location-operations.service';

describe('PracticeLocationOperationsService', () => {
  const prisma = {
    doctorProfile: { findUnique: jest.fn() },
    practiceLocation: { findFirst: jest.fn() },
    appointment: { findMany: jest.fn(), findFirst: jest.fn() },
    queueEvent: { findMany: jest.fn() },
  };
  const mobileNumbers = { decrypt: jest.fn() };
  const service = new PracticeLocationOperationsService(
    prisma as unknown as PrismaService,
    mobileNumbers as unknown as MobileNumberService,
  );

  beforeEach(() => jest.clearAllMocks());

  it('rejects an invalid service date before reading data', async () => {
    await expect(
      service.getOverview('doctor-1', 'clinic-1', '08/25/2026'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.doctorProfile.findUnique).not.toHaveBeenCalled();
  });

  it('does not disclose a clinic to an unrelated authenticated account', async () => {
    prisma.doctorProfile.findUnique.mockResolvedValue(null);
    await expect(
      service.getOverview('secretary-1', 'clinic-1', '2026-08-25'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('does not disclose a clinic outside the doctor ownership scope', async () => {
    prisma.doctorProfile.findUnique.mockResolvedValue({
      id: 'doctor-profile-1',
    });
    prisma.practiceLocation.findFirst.mockResolvedValue(null);
    await expect(
      service.getOverview('doctor-1', 'clinic-2', '2026-08-25'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('builds the overview from authoritative clinic-day and recurring schedule state', async () => {
    prisma.doctorProfile.findUnique.mockResolvedValue({
      id: 'doctor-profile-1',
    });
    prisma.practiceLocation.findFirst.mockResolvedValue({
      id: 'clinic-1',
      name: 'North Clinic',
      addressLine1: '123 Health St.',
      cityMunicipality: 'Davao City',
      province: null,
      countryCode: 'PH',
      timeZone: 'Asia/Manila',
      lifecycleStatus: PracticeLocationLifecycleStatus.ACTIVE,
      doctorProfile: {
        professionalTitle: 'Dr.',
        user: { firstName: 'Juan', lastName: 'Dela Cruz' },
      },
      practiceSchedules: [
        {
          isOpen: true,
          opensAtLocal: new Date('1970-01-01T08:00:00.000Z'),
          closesAtLocal: new Date('1970-01-01T17:00:00.000Z'),
        },
      ],
      scheduleExceptions: [],
      clinicDays: [
        {
          id: 'day-1',
          status: ClinicDayStatus.STARTED,
          openingOverrideAt: null,
          startedAt: new Date('2026-08-25T00:00:00.000Z'),
          closedAt: null,
          operatingPracticeStaff: {
            id: 'staff-1',
            user: {
              id: 'secretary-1',
              firstName: 'Maria',
              lastName: 'Santos',
            },
          },
        },
      ],
    });
    prisma.appointment.findMany.mockResolvedValue([
      {
        id: 'a1',
        bookingReference: 'APP-1',
        queueNumber: 1,
        firstName: 'Ana',
        lastName: 'Garcia',
        status: AppointmentStatus.CALLED,
        estimatedServiceMinutes: 15,
        calledAt: new Date(),
        completedAt: null,
        createdAt: new Date(),
        bookedServices: [{ serviceNameSnapshot: 'Consultation' }],
      },
      {
        id: 'a2',
        bookingReference: 'APP-2',
        queueNumber: 2,
        firstName: 'Pedro',
        lastName: 'Reyes',
        status: AppointmentStatus.WAITING,
        estimatedServiceMinutes: 20,
        calledAt: null,
        completedAt: null,
        createdAt: new Date(),
        bookedServices: [{ serviceNameSnapshot: 'Dental Cleaning' }],
      },
    ]);
    prisma.queueEvent.findMany.mockResolvedValue([]);

    const result = await service.getOverview(
      'doctor-1',
      'clinic-1',
      '2026-08-25',
    );
    expect(result.clinic.doctorName).toBe('Dr. Juan Dela Cruz');
    expect(result.schedule).toEqual({
      isOpen: true,
      opensAt: '08:00',
      closesAt: '17:00',
    });
    expect(result.queue.waitingCount).toBe(1);
    expect(result.queue.nowServing?.queueNumber).toBe(1);
    expect(result.queue.next?.queueNumber).toBe(2);
    expect(result.clinicDay?.operatingSecretary?.name).toBe('Maria Santos');
  });

  it('gives a service-date schedule exception precedence over the recurring schedule', async () => {
    prisma.doctorProfile.findUnique.mockResolvedValue({
      id: 'doctor-profile-1',
    });
    prisma.practiceLocation.findFirst.mockResolvedValue({
      id: 'clinic-1',
      name: 'North Clinic',
      addressLine1: '123 Health St.',
      cityMunicipality: 'Davao City',
      province: null,
      countryCode: 'PH',
      timeZone: 'Asia/Manila',
      lifecycleStatus: PracticeLocationLifecycleStatus.ACTIVE,
      doctorProfile: {
        professionalTitle: 'Dr.',
        user: { firstName: 'Juan', lastName: 'Dela Cruz' },
      },
      practiceSchedules: [
        {
          isOpen: true,
          opensAtLocal: new Date('1970-01-01T08:00:00.000Z'),
          closesAtLocal: new Date('1970-01-01T17:00:00.000Z'),
        },
      ],
      scheduleExceptions: [
        {
          isOpen: true,
          opensAtLocal: new Date('1970-01-01T10:00:00.000Z'),
          closesAtLocal: new Date('1970-01-01T14:00:00.000Z'),
        },
      ],
      clinicDays: [],
    });
    prisma.appointment.findMany.mockResolvedValue([]);
    prisma.queueEvent.findMany.mockResolvedValue([]);

    const result = await service.getOverview(
      'doctor-1',
      'clinic-1',
      '2026-08-25',
    );

    expect(result.schedule).toEqual({
      isOpen: true,
      opensAt: '10:00',
      closesAt: '14:00',
    });
  });

  it('returns a closed service date when the schedule exception closes the clinic', async () => {
    prisma.doctorProfile.findUnique.mockResolvedValue({
      id: 'doctor-profile-1',
    });
    prisma.practiceLocation.findFirst.mockResolvedValue({
      id: 'clinic-1',
      name: 'North Clinic',
      addressLine1: '123 Health St.',
      cityMunicipality: 'Davao City',
      province: null,
      countryCode: 'PH',
      timeZone: 'Asia/Manila',
      lifecycleStatus: PracticeLocationLifecycleStatus.ACTIVE,
      doctorProfile: {
        professionalTitle: 'Dr.',
        user: { firstName: 'Juan', lastName: 'Dela Cruz' },
      },
      practiceSchedules: [
        {
          isOpen: true,
          opensAtLocal: new Date('1970-01-01T08:00:00.000Z'),
          closesAtLocal: new Date('1970-01-01T17:00:00.000Z'),
        },
      ],
      scheduleExceptions: [
        { isOpen: false, opensAtLocal: null, closesAtLocal: null },
      ],
      clinicDays: [],
    });
    prisma.appointment.findMany.mockResolvedValue([]);
    prisma.queueEvent.findMany.mockResolvedValue([]);

    const result = await service.getOverview(
      'doctor-1',
      'clinic-1',
      '2026-08-25',
    );

    expect(result.schedule).toEqual({
      isOpen: false,
      opensAt: null,
      closesAt: null,
    });
  });

  it('returns only authoritative queue events in appointment history', async () => {
    prisma.practiceLocation.findFirst.mockResolvedValue({ id: 'clinic-1' });
    mobileNumbers.decrypt.mockReturnValue('+639171234567');
    prisma.appointment.findFirst.mockResolvedValue({
      id: 'a1',
      bookingReference: 'CQ-ABC123',
      queueNumber: 6,
      status: AppointmentStatus.CALLED,
      serviceDate: new Date('2026-08-25T00:00:00.000Z'),
      estimatedServiceMinutes: 15,
      firstName: 'Maria',
      middleName: null,
      lastName: 'Santos',
      suffix: null,
      mobileNumberEncrypted: 'encrypted',
      mobileNumberLastFour: '4567',
      createdAt: new Date('2026-08-25T00:15:00.000Z'),
      createdByUserId: null,
      calledAt: new Date('2026-08-25T01:15:00.000Z'),
      completedAt: null,
      cancelledAt: null,
      bookedServices: [
        {
          practiceLocationServiceId: 'service-1',
          serviceNameSnapshot: 'Consultation',
          durationMinutesSnapshot: 15,
        },
      ],
      appointmentAnswers: [
        {
          answerText: 'Toothache',
          answerNumber: null,
          answerBoolean: null,
          selectedOptionValue: null,
          createdAt: new Date(),
          bookingQuestion: {
            id: 'question-1',
            questionText: 'Reason?',
            displayOrder: 1,
          },
        },
      ],
      queueEventLinks: [
        {
          role: 'SUBJECT',
          queueEvent: {
            id: 'event-1',
            type: 'CALL_NEXT',
            createdAt: new Date('2026-08-25T01:15:00.000Z'),
            actorType: 'USER',
            actorUser: {
              firstName: 'Juan',
              lastName: 'Dela Cruz',
              role: 'DOCTOR',
            },
          },
        },
      ],
    });

    const result = await service.getAppointmentDetails(
      'doctor-1',
      'clinic-1',
      'a1',
    );
    expect(result.mobileNumber).toBe('+639171234567');
    expect(result.services[0].name).toBe('Consultation');
    expect(result.answers[0].answer).toBe('Toothache');
    expect(result.history).toHaveLength(1);
    expect(result.history[0]).toMatchObject({
      id: 'event-1',
      type: 'CALL_NEXT',
      actorName: 'Juan Dela Cruz',
    });
  });
});
