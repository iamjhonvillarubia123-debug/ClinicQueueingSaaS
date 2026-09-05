import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const path = 'test/start-clinic.e2e-spec.ts';
let content = readFileSync(path, 'utf8').replaceAll('\r\n', '\n');

const importFrom = "import { randomUUID } from 'crypto';";
const importTo = "import { createHash, randomUUID } from 'crypto';";
if (!content.includes(importFrom) && !content.includes(importTo)) {
  throw new Error('START CLINIC crypto import shape changed.');
}
if (content.includes(importFrom)) {
  content = content.replace(importFrom, importTo);
}

const keyFrom = "        activeAppointmentKey: `M7S-ACTIVE-${suffix}-${scope}`,";
const keyTo =
  "        activeAppointmentKey: createHash('sha256')\n          .update(`M7S-ACTIVE-${suffix}-${scope}`)\n          .digest('hex'),";
if (!content.includes(keyFrom) && !content.includes(keyTo)) {
  throw new Error('START CLINIC activeAppointmentKey fixture shape changed.');
}
if (content.includes(keyFrom)) {
  content = content.replace(keyFrom, keyTo);
}

writeFileSync(path, content, 'utf8');
unlinkSync(fileURLToPath(import.meta.url));
console.log('START CLINIC active appointment key fixture reconciled; one-time script removed.');
