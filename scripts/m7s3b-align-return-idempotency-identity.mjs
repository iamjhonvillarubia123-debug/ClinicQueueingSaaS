import { readFile, writeFile } from 'node:fs/promises';

const path = 'src/queue/return-to-queue.service.ts';
const source = await readFile(path, 'utf8');
const before = `    const identityScope = {
      practiceLocationId: dto.practiceLocationId,
      serviceDate: dto.serviceDate,
      actorUserId: authenticatedUserId,
    };
    const requestPayload = {
      ...identityScope,
      appointmentId: dto.appointmentId,
    };`;
const after = `    const identityScope = {
      appointmentId: dto.appointmentId,
      actorUserId: authenticatedUserId,
    };
    const requestPayload = {
      practiceLocationId: dto.practiceLocationId,
      serviceDate: dto.serviceDate,
      ...identityScope,
    };`;

if (!source.includes(before)) {
  throw new Error(
    'RETURN TO QUEUE idempotency identity: expected source contract was not found',
  );
}

const updated = source.replace(before, after);
await writeFile(path, updated, 'utf8');
console.log('RETURN TO QUEUE idempotency identity: aligned');
