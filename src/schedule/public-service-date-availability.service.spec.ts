import { ConflictException, NotFoundException } from '@nestjs/common';
import { PracticeLocationLifecycleStatus } from '../../generated/prisma/client';
import { PublicServiceDateAvailabilityService } from './public-service-date-availability.service';

describe('PublicServiceDateAvailabilityService', () => {
  const prismaMock = {
    practiceLocation: { findUnique: jest.fn() },
    clinicDay: { findUnique: jest.fn() },
  };
  const scheduleResolutionMock = {
    resolveConfiguredSchedule: jest.fn(),
  };
  const doctorCalendarMock = {
    isAvailableForInterval: jest.fn(),
  };
  const crossLocationMock = {
    assertNoConflictForInterval: jest.fn(),
  };
  const scheduleTimeMock = {
    parseServiceDate: jest.fn(),
  };

  let service: PublicServiceDateAvailabilityService;

  const openSchedule = {
    practiceLocationId: 'location-1',
    serviceDate: '2026-08-17',
    timeZone: 'Asia/Manila',
    isOpen: true,
    source: 'PRACTICE_SCHEDULE' as const,
    opensAt: new Date('2026-08-17T01:00:00.000Z'),
    closesAt: new Date('2026-08-17T09:00:00.000Z'),
    maximumOnlineBookingUntilAt: new Date('2026-08-17T05:00:00.000Z'),
    maximumOperatingUntilAt: new Date('2026-08-17T10:00:00.000Z'),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new PublicServiceDateAvailabilityService(
      prismaMock as never,
      scheduleResolutionMock as never,
      doctorCalendarMock as never,
      crossLocationMock as never,
      scheduleTimeMock as never,
    );
    scheduleTimeMock.parseServiceDate.mockReturnValue({
      year: 2026,
      month: 8,
      day: 17,
    });
    prismaMock.practiceLocation.findUnique.mockResolvedValue({
      id: 'location-1',
      doctorProfileId: 'doctor-1',
      lifecycleStatus: PracticeLocationLifecycleStatus.ACTIVE,
      isBookingEnabled: true,
      doctorProfile: { accountSettings: { allowOnlineBooking: true } },
    });
    scheduleResolutionMock.resolveConfiguredSchedule.mockResolvedValue(
      openSchedule,
    );
    doctorCalendarMock.isAvailableForInterval.mockResolvedValue(true);
    crossLocationMock.assertNoConflictForInterval.mockResolvedValue(undefined);
    prismaMock.clinicDay.findUnique.mockResolvedValue(null);
  });

  it('rejects a missing PracticeLocation', async () => {
    prismaMock.practiceLocation.findUnique.mockResolvedValue(null);

    await expect(
      service.resolve('missing', '2026-08-17'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('stops at lifecycle and online-booking eligibility before schedule resolution', async () => {
    prismaMock.practiceLocation.findUnique.mockResolvedValue({
      id: 'location-1',
      doctorProfileId: 'doctor-1',
      lifecycleStatus: PracticeLocationLifecycleStatus.DISABLED,
      isBookingEnabled: true,
      doctorProfile: { accountSettings: { allowOnlineBooking: true } },
    });

    await expect(
      service.resolve('location-1', '2026-08-17'),
    ).resolves.toMatchObject({
      availableForPublicBooking: false,
      reason: 'LOCATION_UNAVAILABLE',
    });
    expect(
      scheduleResolutionMock.resolveConfiguredSchedule,
    ).not.toHaveBeenCalled();
  });

  it('returns no-open-schedule when the effective recurring/exception layer is closed', async () => {
    scheduleResolutionMock.resolveConfiguredSchedule.mockResolvedValue({
      ...openSchedule,
      isOpen: false,
      source: 'SCHEDULE_EXCEPTION',
      opensAt: null,
      closesAt: null,
      maximumOnlineBookingUntilAt: null,
      maximumOperatingUntilAt: null,
    });

    await expect(
      service.resolve('location-1', '2026-08-17'),
    ).resolves.toMatchObject({
      availableForPublicBooking: false,
      reason: 'NO_OPEN_SCHEDULE',
      scheduleSource: 'SCHEDULE_EXCEPTION',
    });
    expect(doctorCalendarMock.isAvailableForInterval).not.toHaveBeenCalled();
  });

  it('applies Doctor Calendar unavailability before cross-location conflict checks', async () => {
    doctorCalendarMock.isAvailableForInterval.mockResolvedValue(false);

    await expect(
      service.resolve('location-1', '2026-08-17'),
    ).resolves.toMatchObject({
      availableForPublicBooking: false,
      reason: 'DOCTOR_CALENDAR_UNAVAILABLE',
    });
    expect(
      crossLocationMock.assertNoConflictForInterval,
    ).not.toHaveBeenCalled();
  });

  it('reports cross-location conflict after Calendar availability', async () => {
    crossLocationMock.assertNoConflictForInterval.mockRejectedValue(
      new ConflictException('conflict'),
    );

    await expect(
      service.resolve('location-1', '2026-08-17'),
    ).resolves.toMatchObject({
      availableForPublicBooking: false,
      reason: 'CROSS_LOCATION_CONFLICT',
    });
  });

  it('uses the ClinicDay Service-Date public cutoff override when present', async () => {
    prismaMock.clinicDay.findUnique.mockResolvedValue({
      status: 'NOT_STARTED',
      maximumOnlineBookingUntilAt: new Date('2026-08-17T04:00:00.000Z'),
    });

    const result = await service.resolve(
      'location-1',
      '2026-08-17',
      new Date('2026-08-17T04:00:00.000Z'),
    );

    expect(result).toMatchObject({
      availableForPublicBooking: false,
      reason: 'PUBLIC_BOOKING_CUTOFF_REACHED',
      maximumOnlineBookingUntilAt: new Date('2026-08-17T04:00:00.000Z'),
      maximumOperatingUntilAt: openSchedule.maximumOperatingUntilAt,
    });
  });

  it('does not treat maximumOperatingUntilAt as the public booking cutoff', async () => {
    scheduleResolutionMock.resolveConfiguredSchedule.mockResolvedValue({
      ...openSchedule,
      maximumOnlineBookingUntilAt: null,
      maximumOperatingUntilAt: new Date('2026-08-17T03:00:00.000Z'),
    });

    const result = await service.resolve(
      'location-1',
      '2026-08-17',
      new Date('2026-08-17T04:00:00.000Z'),
    );

    expect(result).toMatchObject({
      availableForPublicBooking: true,
      reason: 'AVAILABLE',
      maximumOnlineBookingUntilAt: null,
      maximumOperatingUntilAt: new Date('2026-08-17T03:00:00.000Z'),
    });
  });

  it('blocks public admission for cancelled or closed ClinicDay without changing schedule meaning', async () => {
    prismaMock.clinicDay.findUnique.mockResolvedValue({
      status: 'CANCELLED',
      maximumOnlineBookingUntilAt: null,
    });

    await expect(
      service.resolve('location-1', '2026-08-17'),
    ).resolves.toMatchObject({
      availableForPublicBooking: false,
      reason: 'CLINIC_DAY_NOT_ACCEPTING_PUBLIC_BOOKING',
      opensAt: openSchedule.opensAt,
      closesAt: openSchedule.closesAt,
    });
  });
});
