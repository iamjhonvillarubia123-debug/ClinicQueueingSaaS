import { ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PracticeLocationOperationsContextService } from './practice-location-operations-context.service';

describe('PracticeLocationOperationsContextService', () => {
  const prisma = {
    practiceLocation: { findFirst: jest.fn() },
  };
  const service = new PracticeLocationOperationsContextService(
    prisma as unknown as PrismaService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-08-30T16:30:00.000Z'));
  });

  afterEach(() => jest.useRealTimers());

  it('derives today from the authoritative clinic timezone rather than UTC', async () => {
    prisma.practiceLocation.findFirst.mockResolvedValue({
      id: 'clinic-1',
      name: 'North Clinic',
      timeZone: 'Asia/Manila',
      doctorProfile: { userId: 'doctor-1' },
      staffAssignments: [],
    });

    await expect(service.getContext('doctor-1', 'clinic-1')).resolves.toEqual({
      practiceLocationId: 'clinic-1',
      clinicName: 'North Clinic',
      timeZone: 'Asia/Manila',
      currentServiceDate: '2026-08-31',
      defaultServiceDate: '2026-08-31',
      allowedServiceDateRanges: null,
    });
  });

  it('does not disclose a clinic outside the doctor ownership scope', async () => {
    prisma.practiceLocation.findFirst.mockResolvedValue(null);
    await expect(
      service.getContext('doctor-1', 'clinic-2'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects an operations context when the clinic timezone is missing', async () => {
    prisma.practiceLocation.findFirst.mockResolvedValue({
      id: 'clinic-1',
      name: 'North Clinic',
      timeZone: null,
    });
    await expect(
      service.getContext('doctor-1', 'clinic-1'),
    ).rejects.toBeInstanceOf(ConflictException);
  });
  it.each([
    ['2026-08-31', '2026-08-31', '2026-09-02'],
    ['2026-09-02', '2026-09-02', '2026-09-04'],
    ['2026-08-20', '2026-08-18', '2026-08-20'],
  ])('opens a covered date %s for a substitute', async (expected, from, to) => {
    prisma.practiceLocation.findFirst.mockResolvedValue({
      id: 'clinic-1',
      name: 'Clinic',
      timeZone: 'Asia/Manila',
      doctorProfile: { userId: 'doctor-1' },
      staffAssignments: [
        {
          authorityBundles: [],
          substituteSecretaryCoverages: [
            { fromServiceDate: new Date(from), toServiceDate: new Date(to) },
          ],
        },
      ],
    });
    const result = await service.getContext('substitute', 'clinic-1');
    expect(result.defaultServiceDate).toBe(expected);
    expect(result.allowedServiceDateRanges).toEqual([
      { fromServiceDate: from, toServiceDate: to },
    ]);
  });
  it('keeps regular secretary dates unrestricted', async () => {
    prisma.practiceLocation.findFirst.mockResolvedValue({
      id: 'clinic-1',
      name: 'Clinic',
      timeZone: 'Asia/Manila',
      doctorProfile: { userId: 'doctor-1' },
      staffAssignments: [
        {
          authorityBundles: [{ id: 'bundle' }],
          substituteSecretaryCoverages: [],
        },
      ],
    });
    expect(
      (await service.getContext('secretary', 'clinic-1'))
        .allowedServiceDateRanges,
    ).toBeNull();
  });
});
