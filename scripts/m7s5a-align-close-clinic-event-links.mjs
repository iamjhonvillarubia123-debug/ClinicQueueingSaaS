import fs from 'node:fs';

const path = 'src/queue/close-clinic.service.ts';
let source = fs.readFileSync(path, 'utf8');

const oldBlock = `      const links = [
        ...(current
          ? [
              {
                queueEventId: event.id,
                appointmentId: current.id,
                role: QueueEventAppointmentLinkRole.PRIMARY,
              },
            ]
          : []),
        ...unresolved.map((appointment) => ({
          queueEventId: event.id,
          appointmentId: appointment.id,
          role: QueueEventAppointmentLinkRole.SECONDARY,
        })),
      ];`;

const newBlock = `      const links = current
        ? [
            {
              queueEventId: event.id,
              appointmentId: current.id,
              role: QueueEventAppointmentLinkRole.PRIMARY,
            },
          ]
        : [];`;

if (!source.includes(oldBlock)) {
  throw new Error('M7S5A CLOSE CLINIC event-link source pattern was not found');
}

source = source.replace(oldBlock, newBlock);
fs.writeFileSync(path, source);
console.log('M7S5A CLOSE CLINIC event links aligned to approved PRIMARY/SECONDARY cardinality.');
