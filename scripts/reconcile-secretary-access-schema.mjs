import { readFile, writeFile } from 'node:fs/promises';

const schemaPath = new URL('../prisma/schema.prisma', import.meta.url);
let schema = await readFile(schemaPath, 'utf8');

const fail = (message) => { throw new Error(`Secretary access schema reconciliation failed: ${message}`); };

function insertAfter(pattern, insertion, marker) {
  if (schema.includes(marker)) return;
  const match = schema.match(pattern);
  if (!match || match.index === undefined) fail(`anchor not found for ${marker}`);
  const index = match.index + match[0].length;
  schema = `${schema.slice(0, index)}${insertion}${schema.slice(index)}`;
}

if (!schema.includes('enum SecretaryAccessProfile')) {
  insertAfter(
    /enum PracticeStaffRole \{[\s\S]*?\}\r?\n\r?\n/,
    'enum SecretaryAccessProfile {\n  STANDARD\n  FULL_CLINIC_CONFIGURATION\n  CUSTOM\n}\n\n',
    'enum SecretaryAccessProfile',
  );
}

if (!/enum PracticeStaffCapabilityType \{[\s\S]*?ASSIGN_DAY_SECRETARY[\s\S]*?\}/.test(schema)) {
  schema = schema.replace(
    /(enum PracticeStaffCapabilityType \{\s*\r?\n\s*CANCEL_CLINIC_DAY\s*\r?\n)/,
    '$1  ASSIGN_DAY_SECRETARY\n',
  );
}

if (!schema.includes('accessProfile SecretaryAccessProfile')) {
  const modelMatch = schema.match(/model PracticeStaff \{[\s\S]*?\n\}/);
  if (!modelMatch || modelMatch.index === undefined) fail('PracticeStaff model not found');
  const original = modelMatch[0];
  const updated = original.replace(
    /(\s+isActive\s+Boolean[^\n]*\r?\n)/,
    `$1\n  accessProfile             SecretaryAccessProfile @default(STANDARD)\n  canManageClinicDetails    Boolean @default(false)\n  canManageServices         Boolean @default(false)\n  canManageBookingQuestions Boolean @default(false)\n  canManageSchedules        Boolean @default(false)\n`,
  );
  if (updated === original) fail('PracticeStaff isActive anchor not found');
  schema = schema.replace(original, updated);
}

if (!schema.includes('requestedAccessProfile SecretaryAccessProfile')) {
  const invitationMatch = schema.match(/model SecretaryInvitation \{[\s\S]*?\n\}/);
  if (!invitationMatch || invitationMatch.index === undefined) fail('SecretaryInvitation model not found; run invitation reconciliation first');
  const original = invitationMatch[0];
  const updated = original.replace(
    /(\s+mobileNumber\s+String[^\n]*\r?\n)/,
    `$1\n  requestedAccessProfile             SecretaryAccessProfile @default(STANDARD)\n  requestedCanManageClinicDetails    Boolean @default(false)\n  requestedCanManageServices         Boolean @default(false)\n  requestedCanManageBookingQuestions Boolean @default(false)\n  requestedCanManageSchedules        Boolean @default(false)\n  requestedCancelClinicDay           Boolean @default(false)\n  requestedAssignDaySecretary        Boolean @default(false)\n`,
  );
  if (updated === original) fail('SecretaryInvitation mobileNumber anchor not found');
  schema = schema.replace(original, updated);
}

for (const marker of [
  'enum SecretaryAccessProfile',
  'ASSIGN_DAY_SECRETARY',
  'accessProfile             SecretaryAccessProfile',
  'requestedAccessProfile             SecretaryAccessProfile',
]) {
  if (!schema.includes(marker)) fail(`required marker missing: ${marker}`);
}

await writeFile(schemaPath, schema, 'utf8');
console.log('Secretary access schema reconciliation applied successfully.');
