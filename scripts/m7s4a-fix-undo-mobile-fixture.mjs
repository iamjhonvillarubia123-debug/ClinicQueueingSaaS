import fs from 'node:fs';

const path = 'test/undo-queue.e2e-spec.ts';
let source = fs.readFileSync(path, 'utf8');

const before = `        activeAppointmentKey,\n        mobileNumberHash,\n        firstName: 'Patient',`;
const after = `        activeAppointmentKey,\n        mobileNumberEncrypted: \`fixture-encrypted-\${mobileNumberHash}\`,\n        mobileNumberHash,\n        mobileNumberLastFour: '1234',\n        firstName: 'Patient',`;

if (!source.includes(before)) {
  throw new Error('M7S4A UNDO mobile fixture source pattern was not found');
}

source = source.replace(before, after);
fs.writeFileSync(path, source);
console.log('M7S4A UNDO Appointment mobile fixture aligned.');
