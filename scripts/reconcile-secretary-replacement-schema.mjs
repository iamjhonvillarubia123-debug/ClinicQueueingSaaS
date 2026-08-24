import { readFile, writeFile } from 'node:fs/promises';

const schemaPath = new URL('../prisma/schema.prisma', import.meta.url);
let schema = await readFile(schemaPath, 'utf8');

const fail = (message) => { throw new Error(`Secretary replacement schema reconciliation failed: ${message}`); };

if (!schema.includes('model SecretaryReplacementInvitation {')) {
  const anchor = schema.indexOf('model DoctorDataRetentionAcknowledgement {');
  if (anchor < 0) fail('DoctorDataRetentionAcknowledgement model anchor not found');
  const model = `model SecretaryReplacementInvitation {\n  id String @id @default(uuid())\n\n  practiceLocationId            String\n  invitedByUserId               String\n  replacementForPracticeStaffId String\n\n  normalizedEmail String @db.VarChar(255)\n  firstName       String @db.VarChar(100)\n  lastName        String @db.VarChar(100)\n  mobileNumber    String @db.VarChar(30)\n\n  requestedAccessProfile             SecretaryAccessProfile @default(STANDARD)\n  requestedCanManageClinicDetails    Boolean @default(false)\n  requestedCanManageServices         Boolean @default(false)\n  requestedCanManageBookingQuestions Boolean @default(false)\n  requestedCanManageSchedules        Boolean @default(false)\n  requestedCancelClinicDay           Boolean @default(false)\n  requestedAssignDaySecretary        Boolean @default(false)\n\n  tokenHash           String? @db.VarChar(64)\n  activeInvitationKey String? @unique @db.VarChar(64)\n  status              SecretaryInvitationStatus @default(PENDING)\n\n  expiresAt      DateTime  @db.Timestamptz(3)\n  acceptedAt     DateTime? @db.Timestamptz(3)\n  acceptedUserId String?\n  revokedAt      DateTime? @db.Timestamptz(3)\n\n  createdAt DateTime @default(now()) @db.Timestamptz(3)\n  updatedAt DateTime @updatedAt @db.Timestamptz(3)\n\n  practiceLocation PracticeLocation @relation(fields: [practiceLocationId], references: [id], onDelete: Restrict)\n  invitedByUser    User             @relation(\"SecretaryReplacementInvitationInvitedBy\", fields: [invitedByUserId], references: [id], onDelete: Restrict)\n  acceptedUser     User?            @relation(\"SecretaryReplacementInvitationAcceptedUser\", fields: [acceptedUserId], references: [id], onDelete: Restrict)\n\n  @@index([tokenHash])\n  @@index([status, expiresAt])\n  @@index([practiceLocationId, createdAt])\n  @@index([replacementForPracticeStaffId, status])\n  @@index([acceptedUserId])\n}\n\n`;
  schema = `${schema.slice(0, anchor)}${model}${schema.slice(anchor)}`;
}

if (!schema.includes('secretaryReplacementInvitationsSent')) {
  const userMatch = schema.match(/model User \{[\s\S]*?\n\}/);
  if (!userMatch) fail('User model not found');
  const original = userMatch[0];
  const updated = original.replace(
    /(\s+passwordResets\s+PasswordReset\[\][^\n]*\r?\n)/,
    `$1  secretaryReplacementInvitationsSent SecretaryReplacementInvitation[] @relation(\"SecretaryReplacementInvitationInvitedBy\")\n  acceptedSecretaryReplacementInvitations SecretaryReplacementInvitation[] @relation(\"SecretaryReplacementInvitationAcceptedUser\")\n`,
  );
  if (updated === original) fail('User passwordResets anchor not found');
  schema = schema.replace(original, updated);
}

if (!schema.includes('secretaryReplacementInvitations SecretaryReplacementInvitation[]')) {
  const locationMatch = schema.match(/model PracticeLocation \{[\s\S]*?\n\}/);
  if (!locationMatch) fail('PracticeLocation model not found');
  const original = locationMatch[0];
  const updated = original.replace(
    /(\s+secretarySettingsDrafts\s+SecretarySettingsDraft\[\][^\n]*\r?\n)/,
    `$1  secretaryReplacementInvitations SecretaryReplacementInvitation[]\n`,
  );
  if (updated === original) fail('PracticeLocation secretarySettingsDrafts anchor not found');
  schema = schema.replace(original, updated);
}

for (const marker of [
  'model SecretaryReplacementInvitation {',
  'secretaryReplacementInvitationsSent',
  'acceptedSecretaryReplacementInvitations',
  'secretaryReplacementInvitations SecretaryReplacementInvitation[]',
]) {
  if (!schema.includes(marker)) fail(`required marker missing: ${marker}`);
}

await writeFile(schemaPath, schema, 'utf8');
console.log('Secretary replacement schema reconciliation applied successfully.');
