import { readFile, writeFile } from 'node:fs/promises';

const schemaPath = new URL('../prisma/schema.prisma', import.meta.url);
let schema = await readFile(schemaPath, 'utf8');

const fail = (message) => { throw new Error(`Secretary access schema reconciliation failed: ${message}`); };

function replaceModel(name, transform) {
  const pattern = new RegExp(`model ${name} \\{[\\s\\S]*?\\n\\}`, 'm');
  const match = schema.match(pattern);
  if (!match) fail(`${name} model not found`);
  const updated = transform(match[0]);
  schema = schema.replace(match[0], updated);
}

function removeFieldLines(model, fieldNames) {
  const names = fieldNames.join('|');
  return model.replace(new RegExp(`^\\s*(?:${names})\\s+[^\\n]*\\r?\\n`, 'gm'), '');
}

if (!/enum SecretaryAccessProfile\s*\{/.test(schema)) {
  const match = schema.match(/enum PracticeStaffRole \{[\s\S]*?\}\r?\n\r?\n/);
  if (!match || match.index === undefined) fail('PracticeStaffRole enum anchor not found');
  const index = match.index + match[0].length;
  schema = `${schema.slice(0, index)}enum SecretaryAccessProfile {\n  STANDARD\n  FULL_CLINIC_CONFIGURATION\n  CUSTOM\n}\n\n${schema.slice(index)}`;
}

if (!/enum PracticeStaffCapabilityType \{[\s\S]*?\bASSIGN_DAY_SECRETARY\b[\s\S]*?\}/.test(schema)) {
  const updated = schema.replace(
    /(enum PracticeStaffCapabilityType \{\s*\r?\n\s*CANCEL_CLINIC_DAY\s*\r?\n)/,
    '$1  ASSIGN_DAY_SECRETARY\n',
  );
  if (updated === schema) fail('PracticeStaffCapabilityType CANCEL_CLINIC_DAY anchor not found');
  schema = updated;
}

replaceModel('PracticeStaff', (original) => {
  const fieldNames = [
    'accessProfile',
    'canManageClinicDetails',
    'canManageServices',
    'canManageBookingQuestions',
    'canManageSchedules',
  ];
  const cleaned = removeFieldLines(original, fieldNames);
  const updated = cleaned.replace(
    /(\s+isActive\s+Boolean[^\n]*\r?\n)/,
    `$1\n  accessProfile             SecretaryAccessProfile @default(STANDARD)\n  canManageClinicDetails    Boolean @default(false)\n  canManageServices         Boolean @default(false)\n  canManageBookingQuestions Boolean @default(false)\n  canManageSchedules        Boolean @default(false)\n`,
  );
  if (updated === cleaned) fail('PracticeStaff isActive anchor not found');
  return updated;
});

replaceModel('SecretaryInvitation', (original) => {
  const fieldNames = [
    'requestedAccessProfile',
    'requestedCanManageClinicDetails',
    'requestedCanManageServices',
    'requestedCanManageBookingQuestions',
    'requestedCanManageSchedules',
    'requestedCancelClinicDay',
    'requestedAssignDaySecretary',
  ];
  const cleaned = removeFieldLines(original, fieldNames);
  const updated = cleaned.replace(
    /(\s+mobileNumber\s+String[^\n]*\r?\n)/,
    `$1\n  requestedAccessProfile             SecretaryAccessProfile @default(STANDARD)\n  requestedCanManageClinicDetails    Boolean @default(false)\n  requestedCanManageServices         Boolean @default(false)\n  requestedCanManageBookingQuestions Boolean @default(false)\n  requestedCanManageSchedules        Boolean @default(false)\n  requestedCancelClinicDay           Boolean @default(false)\n  requestedAssignDaySecretary        Boolean @default(false)\n`,
  );
  if (updated === cleaned) fail('SecretaryInvitation mobileNumber anchor not found');
  return updated;
});

const staffAccessCount = (schema.match(/\baccessProfile\s+SecretaryAccessProfile\b/g) ?? []).length;
if (staffAccessCount !== 1) fail(`accessProfile count is ${staffAccessCount}; expected 1`);

const invitationAccessCount = (schema.match(/\brequestedAccessProfile\s+SecretaryAccessProfile\b/g) ?? []).length;
const expectedInvitationAccessCount = schema.includes('model SecretaryReplacementInvitation {') ? 2 : 1;
if (invitationAccessCount !== expectedInvitationAccessCount) {
  fail(`requestedAccessProfile count is ${invitationAccessCount}; expected ${expectedInvitationAccessCount}`);
}

await writeFile(schemaPath, schema, 'utf8');
console.log('Secretary access schema reconciliation applied successfully.');
