import { readFile, writeFile } from 'node:fs/promises';

const path = 'test/next-patient.e2e-spec.ts';
const source = await readFile(path, 'utf8');

const before = `  it('serializes concurrent distinct NEXT PATIENT commands so only one advances the queue', async () => {
    const serviceDate = '2026-09-09';
    const queue = await createClinicDayWithQueue(serviceDate, 3);

    const settled = await Promise.allSettled([
      service.advance(
        doctorUserId,
        dto(serviceDate, NextPatientOutcome.COMPLETED),
        \`race-a-\${scope}\`,
      ),
      service.advance(
        doctorUserId,
        dto(serviceDate, NextPatientOutcome.COMPLETED),
        \`race-b-\${scope}\`,
      ),
    ]);

    expect(settled.filter((item) => item.status === 'fulfilled')).toHaveLength(
      1,
    );
    expect(settled.filter((item) => item.status === 'rejected')).toHaveLength(
      1,
    );

    const [events, commands, firstAfter, secondAfter, thirdAfter] =
      await Promise.all([
        prisma.queueEvent.findMany({
          where: { practiceLocationId, serviceDate: dateValue(serviceDate) },
        }),
        prisma.commandIdempotency.findMany({
          where: {
            commandType: 'NEXT_PATIENT',
            practiceLocationId,
            serviceDate: dateValue(serviceDate),
          },
        }),
        prisma.appointment.findUniqueOrThrow({ where: { id: queue.currentId } }),
        prisma.appointment.findUniqueOrThrow({ where: { id: queue.nextId } }),
        prisma.appointment.findUniqueOrThrow({ where: { id: queue.thirdId! } }),
      ]);

    expect(events).toHaveLength(1);
    expect(commands).toHaveLength(1);
    expect(firstAfter.status).toBe(AppointmentStatus.COMPLETED);
    expect(secondAfter.status).toBe(AppointmentStatus.CALLED);
    expect(thirdAfter.status).toBe(AppointmentStatus.WAITING);
  });`;

const after = `  it('serializes concurrent distinct NEXT PATIENT commands into ordered queue progressions', async () => {
    const serviceDate = '2026-09-09';
    const queue = await createClinicDayWithQueue(serviceDate, 3);

    const settled = await Promise.allSettled([
      service.advance(
        doctorUserId,
        dto(serviceDate, NextPatientOutcome.COMPLETED),
        \`race-a-\${scope}\`,
      ),
      service.advance(
        doctorUserId,
        dto(serviceDate, NextPatientOutcome.COMPLETED),
        \`race-b-\${scope}\`,
      ),
    ]);

    expect(settled.filter((item) => item.status === 'fulfilled')).toHaveLength(
      2,
    );
    expect(settled.filter((item) => item.status === 'rejected')).toHaveLength(
      0,
    );

    const [events, commands, firstAfter, secondAfter, thirdAfter] =
      await Promise.all([
        prisma.queueEvent.findMany({
          where: { practiceLocationId, serviceDate: dateValue(serviceDate) },
          orderBy: { queueEventSequence: 'asc' },
        }),
        prisma.commandIdempotency.findMany({
          where: {
            commandType: 'NEXT_PATIENT',
            practiceLocationId,
            serviceDate: dateValue(serviceDate),
          },
        }),
        prisma.appointment.findUniqueOrThrow({ where: { id: queue.currentId } }),
        prisma.appointment.findUniqueOrThrow({ where: { id: queue.nextId } }),
        prisma.appointment.findUniqueOrThrow({ where: { id: queue.thirdId! } }),
      ]);

    expect(events).toHaveLength(2);
    expect(events.map((event) => event.queueEventSequence)).toEqual([1, 2]);
    expect(commands).toHaveLength(2);
    expect(firstAfter.status).toBe(AppointmentStatus.COMPLETED);
    expect(secondAfter.status).toBe(AppointmentStatus.COMPLETED);
    expect(thirdAfter.status).toBe(AppointmentStatus.CALLED);
  });`;

const normalized = source.replaceAll('\r\n', '\n');
if (!normalized.includes(before)) {
  throw new Error('NEXT PATIENT concurrency test: expected source block was not found');
}

const updated = normalized.replace(before, after);
await writeFile(path, updated, 'utf8');
console.log('M7S2 NEXT PATIENT concurrency expectation aligned.');
