import { readFile, writeFile } from 'node:fs/promises';

const schemaPath = new URL('../prisma/schema.prisma', import.meta.url);
let schema = await readFile(schemaPath, 'utf8');
const fail = (message) => { throw new Error(`Secretary clinic-details schema reconciliation failed: ${message}`); };

if (!schema.includes('model SecretarySettingsDraftClinicDetails {')) {
  const anchor = schema.indexOf('model DoctorServiceTemplate {');
  if (anchor < 0) fail('DoctorServiceTemplate model anchor not found');
  const model = `model SecretarySettingsDraftClinicDetails {\n  id String @id @default(uuid())\n\n  secretarySettingsDraftId String @unique\n\n  proposedName             String @db.VarChar(200)\n  proposedAddressLine1     String @db.VarChar(255)\n  proposedAddressLine2     String? @db.VarChar(255)\n  proposedCityMunicipality String @db.VarChar(120)\n  proposedProvince         String @db.VarChar(120)\n  proposedPostalCode       String? @db.VarChar(20)\n  proposedContactNumber    String @db.VarChar(30)\n  proposedCountryCode      String @db.Char(2)\n  proposedTimeZone         String @db.VarChar(100)\n\n  createdAt DateTime @default(now()) @db.Timestamptz(3)\n  updatedAt DateTime @updatedAt @db.Timestamptz(3)\n\n  secretarySettingsDraft SecretarySettingsDraft @relation(fields: [secretarySettingsDraftId], references: [id], onDelete: Restrict)\n}\n\n`;
  schema = `${schema.slice(0, anchor)}${model}${schema.slice(anchor)}`;
}

const draftMatch = schema.match(/model SecretarySettingsDraft \{[\s\S]*?\n\}/);
if (!draftMatch) fail('SecretarySettingsDraft model not found');
if (!/\bproposedClinicDetails\s+SecretarySettingsDraftClinicDetails\?/.test(draftMatch[0])) {
  const updated = draftMatch[0].replace(
    /(\s+proposedServices\s+SecretarySettingsDraftService\[\][^\n]*\r?\n)/,
    `$1  proposedClinicDetails       SecretarySettingsDraftClinicDetails?\n`,
  );
  if (updated === draftMatch[0]) fail('SecretarySettingsDraft proposedServices anchor not found');
  schema = schema.replace(draftMatch[0], updated);
}

if (!schema.includes('model SecretarySettingsDraftClinicDetails {')) fail('clinic-details proposal model missing');
if (!/\bproposedClinicDetails\s+SecretarySettingsDraftClinicDetails\?/.test(schema)) fail('draft clinic-details relation missing');

await writeFile(schemaPath, schema, 'utf8');
console.log('Secretary clinic-details schema reconciliation applied successfully.');
