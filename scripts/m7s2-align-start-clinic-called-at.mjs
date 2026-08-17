import { readFile, writeFile } from 'node:fs/promises';

const path = 'src/queue/start-clinic.service.ts';
const source = await readFile(path, 'utf8');

if (/status:\s*AppointmentStatus\.CALLED,[\s\S]{0,160}?calledAt:\s*now,/.test(source)) {
  console.log('START CLINIC calledAt: already aligned');
  process.exit(0);
}

const pattern = /(status:\s*AppointmentStatus\.CALLED,\r?\n\s*servingOrderKey:\s*null,\r?\n\s*waitingPlacementType:\s*null,)/;
const match = source.match(pattern);
if (!match) {
  throw new Error('START CLINIC calledAt: expected source pattern was not found');
}

const newline = source.includes('\r\n') ? '\r\n' : '\n';
const indentMatch = match[1].match(/\r?\n(\s*)waitingPlacementType:/);
const indent = indentMatch?.[1] ?? '            ';
const replacement = `${match[1]}${newline}${indent}calledAt: now,`;

await writeFile(path, source.replace(pattern, replacement), 'utf8');
console.log('START CLINIC calledAt: aligned');
