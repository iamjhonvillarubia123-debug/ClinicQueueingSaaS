import fs from 'node:fs';

const servicePath = 'src/queue/undo-queue.service.ts';
let source = fs.readFileSync(servicePath, 'utf8');

const before = `    const active = [
      AppointmentStatus.WAITING,
      AppointmentStatus.CALLED,
      AppointmentStatus.TEMPORARILY_ABSENT,
      AppointmentStatus.OUT_FOR_PROCEDURE,
    ].includes(restoredStatus);`;

const after = `    const activeStatuses: AppointmentStatus[] = [
      AppointmentStatus.WAITING,
      AppointmentStatus.CALLED,
      AppointmentStatus.TEMPORARILY_ABSENT,
      AppointmentStatus.OUT_FOR_PROCEDURE,
    ];
    const active = activeStatuses.includes(restoredStatus);`;

if (!source.includes(before)) {
  throw new Error('M7S4A UNDO active-status source pattern was not found');
}

source = source.replace(before, after);
fs.writeFileSync(servicePath, source);
console.log('M7S4A UNDO active-status typing aligned.');
