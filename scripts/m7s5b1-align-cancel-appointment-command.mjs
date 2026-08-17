import fs from 'node:fs';

const path = 'prisma/schema.prisma';
let source = fs.readFileSync(path, 'utf8');

const marker = `  CLOSE_CLINIC\n  CANCEL_CLINIC_DAY`;
const replacement = `  CLOSE_CLINIC\n  CANCEL_APPOINTMENT\n  CANCEL_CLINIC_DAY`;

if (source.includes('  CANCEL_APPOINTMENT\n')) {
  console.log('CommandType CANCEL_APPOINTMENT already aligned.');
} else {
  if (!source.includes(marker)) {
    throw new Error('CommandType CLOSE_CLINIC/CANCEL_CLINIC_DAY marker was not found');
  }
  source = source.replace(marker, replacement);
  fs.writeFileSync(path, source);
  console.log('CommandType CANCEL_APPOINTMENT aligned.');
}
