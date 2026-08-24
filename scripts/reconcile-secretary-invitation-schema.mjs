import { readFile, writeFile } from 'node:fs/promises';

const schemaPath = new URL('../prisma/schema.prisma', import.meta.url);
let schema = await readFile(schemaPath, 'utf8');

const fail = (message) => {
  throw new Error(`SecretaryInvitation schema reconciliation failed: ${message}`);
};

const insertOnce = (anchor, insertion, marker) => {
  if (schema.includes(marker)) return;
  const index = schema.indexOf(anchor);
  if (index < 0) fail(`expected anchor not found for ${marker}`);
  schema = `${schema.slice(0, index + anchor.length)}${insertion}${schema.slice(index + anchor.length)}`;
};

insertOnce(
  `enum EmailVerificationStatus {\n  PENDING\n  VERIFIED\n  REVOKED\n  EXPIRED\n}\n`,
  `\nenum SecretaryInvitationStatus {\n  PENDING\n  ACCEPTED\n  REVOKED\n  EXPIRED\n}\n`,
  'enum SecretaryInvitationStatus',
);

insertOnce(
  `  passwordResets                   PasswordReset[]\n`,
  `  secretaryInvitationsSent         SecretaryInvitation[] @relation("SecretaryInvitationInvitedBy")\n  acceptedSecretaryInvitation        SecretaryInvitation?  @relation("SecretaryInvitationAcceptedUser")\n`,
  'secretaryInvitationsSent',
);

insertOnce(
  `  secretarySettingsDrafts SecretarySettingsDraft[]\n`,
  `  secretaryInvitations    SecretaryInvitation[]\n`,
  'secretaryInvitations    SecretaryInvitation[]',
);

insertOnce(
  `model DoctorDataRetentionAcknowledgement {`,
  `model SecretaryInvitation {\n  id String @id @default(uuid())\n\n  practiceLocationId String\n  invitedByUserId    String\n\n  normalizedEmail String @db.VarChar(255)\n  firstName       String @db.VarChar(100)\n  lastName        String @db.VarChar(100)\n  mobileNumber    String @db.VarChar(30)\n\n  tokenHash           String? @db.VarChar(64)\n  activeInvitationKey String? @unique @db.VarChar(64)\n\n  status SecretaryInvitationStatus @default(PENDING)\n\n  expiresAt DateTime @db.Timestamptz(3)\n  acceptedAt DateTime? @db.Timestamptz(3)\n  acceptedUserId String? @unique\n  revokedAt DateTime? @db.Timestamptz(3)\n\n  createdAt DateTime @default(now()) @db.Timestamptz(3)\n  updatedAt DateTime @updatedAt @db.Timestamptz(3)\n\n  practiceLocation PracticeLocation @relation(fields: [practiceLocationId], references: [id], onDelete: Restrict)\n  invitedByUser    User             @relation("SecretaryInvitationInvitedBy", fields: [invitedByUserId], references: [id], onDelete: Restrict)\n  acceptedUser     User?            @relation("SecretaryInvitationAcceptedUser", fields: [acceptedUserId], references: [id], onDelete: Restrict)\n  notificationOutbox NotificationOutbox? @relation("SecretaryInvitationNotificationOutbox")\n\n  @@index([tokenHash], map: "SecretaryInvitation_tokenHash_idx")\n  @@index([status, expiresAt], map: "SecretaryInvitation_status_expires_idx")\n  @@index([practiceLocationId, createdAt], map: "SecretaryInvitation_location_created_idx")\n  @@index([invitedByUserId, createdAt], map: "SecretaryInvitation_invitedBy_created_idx")\n}\n\n`,
  'model SecretaryInvitation {',
);

insertOnce(
  `  passwordReset     PasswordReset?     @relation("PasswordResetNotificationOutbox", fields: [passwordResetId], references: [id], onDelete: Restrict)\n`,
  `  secretaryInvitation SecretaryInvitation? @relation("SecretaryInvitationNotificationOutbox", fields: [secretaryInvitationId], references: [id], onDelete: Restrict)\n`,
  'SecretaryInvitationNotificationOutbox", fields: [secretaryInvitationId]',
);

const required = [
  'enum SecretaryInvitationStatus',
  'model SecretaryInvitation {',
  'secretaryInvitationsSent',
  'acceptedSecretaryInvitation',
  'secretaryInvitations    SecretaryInvitation[]',
  'SecretaryInvitationNotificationOutbox", fields: [secretaryInvitationId]',
];

for (const marker of required) {
  if (!schema.includes(marker)) fail(`required marker missing after patch: ${marker}`);
}

await writeFile(schemaPath, schema, 'utf8');
console.log('SecretaryInvitation schema reconciliation applied successfully.');
