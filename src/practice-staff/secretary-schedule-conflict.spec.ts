import { assertSecretaryScheduleAvailable } from './secretary-schedule-conflict';
import { Prisma } from '../../generated/prisma/client';
const at = (hour: number) => new Date(Date.UTC(1970, 0, 1, hour));
const clinic = (zone = 'Asia/Manila', start = 9, end = 12) => ({
  id: 'clinic',
  name: 'Existing clinic',
  timeZone: zone,
  practiceSchedules: [
    {
      weekday: 'MONDAY',
      isOpen: true,
      opensAtLocal: at(start),
      closesAtLocal: at(end),
    },
  ],
  scheduleExceptions: [] as unknown[],
});
const range = { fromServiceDate: '2027-01-04', toServiceDate: '2027-01-04' };
function fixture(candidate = clinic(), existing = clinic()) {
  const tx = {
    practiceStaff: {
      findMany: jest.fn().mockResolvedValue([
        {
          authorityBundles: [],
          substituteSecretaryCoverages: [
            {
              fromServiceDate: new Date(range.fromServiceDate),
              toServiceDate: new Date(range.toServiceDate),
            },
          ],
          practiceLocation: existing,
        },
      ]),
    },
    practiceLocation: {
      findUniqueOrThrow: jest.fn().mockResolvedValue(candidate),
    },
  };
  return () =>
    assertSecretaryScheduleAvailable(
      tx as unknown as Prisma.TransactionClient,
      'secretary',
      'new-clinic',
      [range],
      new Date('2026-09-12'),
    );
}
it('allows adjacent hours with no overlap', async () => {
  await expect(
    fixture(clinic('Asia/Manila', 12, 14))(),
  ).resolves.toBeUndefined();
});
it('uses actual instants across time zones', async () => {
  await expect(fixture(clinic('UTC', 1, 3))()).rejects.toThrow('conflicts');
  await expect(fixture(clinic('UTC', 9, 12))()).resolves.toBeUndefined();
});
it('honors closed and changed schedule exceptions', async () => {
  const existing = clinic();
  existing.scheduleExceptions = [
    {
      serviceDate: new Date('2027-01-04'),
      isOpen: false,
      opensAtLocal: null,
      closesAtLocal: null,
    },
  ];
  await expect(fixture(clinic(), existing)()).resolves.toBeUndefined();
  existing.scheduleExceptions = [
    {
      serviceDate: new Date('2027-01-04'),
      isOpen: true,
      opensAtLocal: at(13),
      closesAtLocal: at(15),
    },
  ];
  await expect(
    fixture(clinic('Asia/Manila', 14, 16), existing)(),
  ).rejects.toThrow('conflicts');
});
