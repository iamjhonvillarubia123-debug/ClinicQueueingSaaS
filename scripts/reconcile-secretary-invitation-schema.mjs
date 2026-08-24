import { readFile, writeFile } from 'node:fs/promises';

const schemaPath = new URL('../prisma/schema.prisma', import.meta.url);
let schema = await readFile(schemaPath, 'utf8');

const fail = (message) => {
  throw new Error(`SecretaryInvitation schema reconciliation failed: ${message}`);
};

function modelBlock(name) {
  const match = schema.match(new RegExp(`model ${name} \\{[\\s\\S]*?\\n\\}`, 'm'));
  if (!match) fail(`${name} model not found`);
  return match[0];
}

function modelHasField(modelName, fieldName) {
  const model = modelBlock(modelName);
  return new RegExp(`^\\s*${fieldName}\\s+`, 'm').test(model);
}

const insertAfterLineOnce = (linePattern, insertion, marker) => {
  if (schema.includes(marker)) return;
  const match = schema.match(linePattern);
  if (!match || match.index === undefined) fail(`expected anchor not found for ${marker}`);
  const index = match.index + match[0].length;
  schema = `${schema.slice(0, index)}${insertion}${schema.slice(index)}`;
};

if (!schema.includes('enum SecretaryInvitationStatus')) {
  const passwordResetEnum = schema.indexOf('enum PasswordResetStatus {');
  if (passwordResetEnum < 0) fail('expected anchor not found for enum SecretaryInvitationStatus');
  schema = `${schema.slice(0, passwordResetEnum)}enum SecretaryInvitationStatus {\n  PENDING\n  ACCEPTED\n  REVOKED\n  EXPIRED\n}\n\n${schema.slice(passwordResetEnum)}`;
}

insertAfterLineOnce(
  /^\s*passwordResets\s+PasswordReset\[\]\s*\r?\n/m,
  `  secretaryInvitationsSent         SecretaryInvitation[] @relation("SecretaryInvitationInvitedBy")\n  acceptedSecretaryInvitation        SecretaryInvitation?  @relation("SecretaryInvitationAcceptedUser")\n`,
  'secretaryInvitationsSent',
);

if (!modelHasField('PracticeLocation', 'secretaryInvitations')) {
  const location = modelBlock('PracticeLocation');
  const updated = location.replace(
    /(\s+secretarySettingsDrafts\s+SecretarySettingsDraft\[\][^\n]*\r?\n)/,
    `$1  secretaryInvitations    SecretaryInvitation[]\n`,
  );
  if (updated === location) fail('PracticeLocation secretarySettingsDrafts anchor not found');
  schema = schema.replace(location, updated);
}

if (!schema.includes('model SecretaryInvitation {')) {
  const modelAnchor = schema.indexOf('model DoctorDataRetentionAcknowledgement {');
  if (modelAnchor < 0) fail('expected anchor not found for model SecretaryInvitation {');
  const model = `model SecretaryInvitation {\n  id String @id @default(uuid())\n\n  practiceLocationId String\n  invitedByUserId    String\n\n  normalizedEmail String @db.VarChar(255)\n  firstName       String @db.VarChar(100)\n  lastName        String @db.VarChar(100)\n  mobileNumber    String @db.VarChar(30)\n\n  tokenHash           String? @db.VarChar(64)\n  activeInvitationKey String? @unique @db.VarChar(64)\n\n  status SecretaryInvitationStatus @default(PENDING)\n\n  expiresAt      DateTime  @db.Timestamptz(3)\n  acceptedAt     DateTime? @db.Timestamptz(3)\n  acceptedUserId String?   @unique\n  revokedAt      DateTime? @db.Timestamptz(3)\n\n  createdAt DateTime @default(now()) @db.Timestamptz(3)\n  updatedAt DateTime @updatedAt @db.Timestamptz(3)\n\n  practiceLocation   PracticeLocation    @relation(fields: [practiceLocationId], references: [id], onDelete: Restrict)\n  invitedByUser      User                @relation("SecretaryInvitationInvitedBy", fields: [invitedByUserId], references: [id], onDelete: Restrict)\n  acceptedUser       User?               @relation("SecretaryInvitationAcceptedUser", fields: [acceptedUserId], references: [id], onDelete: Restrict)\n  notificationOutbox NotificationOutbox? @relation("SecretaryInvitationNotificationOutbox")\n\n  @@index([tokenHash], map: "SecretaryInvitation_tokenHash_idx")\n  @@index([status, expiresAt], map: "SecretaryInvitation_status_expires_idx")\n  @@index([practiceLocationId, createdAt], map: "SecretaryInvitation_location_created_idx")\n  @@index([invitedByUserId, createdAt], map: "SecretaryInvitation_invitedBy_created_idx")\n}\n\n`;
  schema = `${schema.slice(0, modelAnchor)}${model}${schema.slice(modelAnchor)}`;
}

insertAfterLineOnce(
  /^\s*passwordReset\s+PasswordReset\?\s+@relation\("PasswordResetNotificationOutbox"[^\n]*\r?\n/m,
  `  secretaryInvitation SecretaryInvitation? @relation("SecretaryInvitationNotificationOutbox", fields: [secretaryInvitationId], references: [id], onDelete: Restrict)\n`,
  'SecretaryInvitationNotificationOutbox", fields: [secretaryInvitationId]',
);

const required = [
  'enum SecretaryInvitationStatus',
  'model SecretaryInvitation {',
  'secretaryInvitationsSent',
  'acceptedSecretaryInvitation',
  'SecretaryInvitationNotificationOutbox", fields: [secretaryInvitationId]',
];

for (const marker of required) {
  if (!schema.includes(marker)) fail(`required marker missing after patch: ${marker}`);
}
if (!modelHasField('PracticeLocation', 'secretaryInvitations')) {
  fail('required PracticeLocation secretaryInvitations relation missing after patch');
}

await writeFile(schemaPath, schema, 'utf8');
console.log('SecretaryInvitation schema reconciliation applied successfully.');
