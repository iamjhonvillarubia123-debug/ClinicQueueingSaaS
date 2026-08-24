import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ServiceAvailabilityStatus } from '../../generated/prisma/client';
import { BookingConfigurationService } from './booking-configuration.service';

describe('BookingConfigurationService', () => {
  let service: BookingConfigurationService;

  const prismaServiceMock = {
    practiceLocation: {
      findFirst: jest.fn(),
    },
    practiceLocationService: {
      findMany: jest.fn(),
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new BookingConfigurationService(prismaServiceMock as never);
  });

  it('returns only effective public booking configuration from an available location in configured presentation order', async () => {
    prismaServiceMock.practiceLocation.findFirst.mockResolvedValue({
      id: 'location-1',
      name: 'Clinic A',
      timeZone: 'Asia/Manila',
      doctorProfile: {
        accountSettings: { maximumAdvanceBookingDays: 30 },
      },
      services: [
        { id: 'service-2', name: 'Follow-up', durationMinutes: 15, displayOrder: 0 },
        { id: 'service-1', name: 'Consultation', durationMinutes: 30, displayOrder: 1 },
      ],
      bookingQuestions: [
        {
          id: 'question-1',
          questionText: 'Reason for visit?',
          helpText: null,
          type: 'TEXT',
          isRequired: true,
          displayOrder: 0,
          estimatedMinutesAdjustment: 0,
          textMaximumLength: 200,
          numberMinimum: null,
          numberMaximum: null,
          selectOptions: null,
        },
      ],
    });

    await expect(
      service.getEffectiveConfiguration('location-1'),
    ).resolves.toEqual(
      expect.objectContaining({
        practiceLocation: {
          id: 'location-1',
          name: 'Clinic A',
          timeZone: 'Asia/Manila',
        },
        bookingWindow: {
          maximumAdvanceBookingDays: 30,
          upperBoundaryInclusive: true,
        },
        services: [
          { id: 'service-2', name: 'Follow-up', durationMinutes: 15, displayOrder: 0 },
          { id: 'service-1', name: 'Consultation', durationMinutes: 30, displayOrder: 1 },
        ],
        serviceSelection: {
          maximumSelections: 3,
          uniqueSelectionsRequired: true,
          orderHasBusinessMeaning: false,
        },
      }),
    );

    expect(prismaServiceMock.practiceLocation.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'location-1',
          isBookingEnabled: true,
        }) as unknown,
        select: expect.objectContaining({
          doctorProfile: expect.any(Object) as unknown,
          services: expect.objectContaining({
            where: { status: ServiceAvailabilityStatus.ACTIVE },
            orderBy: [
              { displayOrder: 'asc' },
              { createdAt: 'asc' },
              { id: 'asc' },
            ],
          }) as unknown,
          bookingQuestions: expect.objectContaining({
            where: { isActive: true },
          }) as unknown,
        }) as unknown,
      }),
    );
  });

  it('rejects unavailable PracticeLocations', async () => {
    prismaServiceMock.practiceLocation.findFirst.mockResolvedValue(null);

    await expect(
      service.getEffectiveConfiguration('location-disabled'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects more than three or duplicate selected Services before querying Services', async () => {
    await expect(
      service.validateSelectedServices('location-1', ['a', 'b', 'c', 'd']),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.validateSelectedServices('location-1', ['a', 'a']),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(
      prismaServiceMock.practiceLocationService.findMany,
    ).not.toHaveBeenCalled();
  });

  it('accepts only active selected Services owned by the selected location', async () => {
    prismaServiceMock.practiceLocation.findFirst.mockResolvedValue({
      id: 'location-1',
    });
    prismaServiceMock.practiceLocationService.findMany.mockResolvedValue([
      { id: 'service-a', name: 'A', durationMinutes: 20 },
      { id: 'service-b', name: 'B', durationMinutes: 40 },
    ]);

    await expect(
      service.validateSelectedServices('location-1', [
        'service-b',
        'service-a',
      ]),
    ).resolves.toEqual([
      { id: 'service-a', name: 'A', durationMinutes: 20 },
      { id: 'service-b', name: 'B', durationMinutes: 40 },
    ]);

    expect(
      prismaServiceMock.practiceLocationService.findMany,
    ).toHaveBeenCalledWith({
      where: {
        id: { in: ['service-b', 'service-a'] },
        practiceLocationId: 'location-1',
        status: ServiceAvailabilityStatus.ACTIVE,
      },
      orderBy: { id: 'asc' },
      select: { id: true, name: true, durationMinutes: true },
    });
  });

  it('rejects stale, inactive, or cross-location Service selections', async () => {
    prismaServiceMock.practiceLocation.findFirst.mockResolvedValue({
      id: 'location-1',
    });
    prismaServiceMock.practiceLocationService.findMany.mockResolvedValue([
      { id: 'service-a', name: 'A', durationMinutes: 20 },
    ]);

    await expect(
      service.validateSelectedServices('location-1', [
        'service-a',
        'service-invalid',
      ]),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('fails closed if stored configuration exceeds five active BookingQuestions', async () => {
    prismaServiceMock.practiceLocation.findFirst.mockResolvedValue({
      id: 'location-1',
      name: 'Clinic A',
      timeZone: 'Asia/Manila',
      doctorProfile: {
        accountSettings: { maximumAdvanceBookingDays: 30 },
      },
      services: [],
      bookingQuestions: Array.from({ length: 6 }, (_, index) => ({
        id: `question-${index}`,
      })),
    });

    await expect(
      service.getEffectiveConfiguration('location-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
