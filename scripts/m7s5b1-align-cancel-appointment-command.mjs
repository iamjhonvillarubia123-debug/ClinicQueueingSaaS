import fs from 'node:fs';

const path = 'prisma/schema.prisma';
let source = fs.readFileSync(path, 'utf8');

if (/^\s*CANCEL_APPOINTMENT\s*$/m.test(source)) {
  console.log('CommandType CANCEL_APPOINTMENT already aligned.');
  process.exit(0);
}

const closeClinicPattern = /(^\s*CLOSE_CLINIC\s*$)/m;
if (!closeClinicPattern.test(source)) {
  throw new Error('CommandType CLOSE_CLINIC marker was not found');
}

source = source.replace(
  closeClinicPattern,
  `$1${source.includes('\r\n') ? '\r\n' : '\n'}  CANCEL_APPOINTMENT`,
);
fs.writeFileSync(path, source);
console.log('CommandType CANCEL_APPOINTMENT aligned.');
