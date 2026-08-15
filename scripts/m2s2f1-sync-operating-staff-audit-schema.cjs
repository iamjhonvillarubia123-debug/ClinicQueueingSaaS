const fs = require('fs');
const path = require('path');

const schemaPath = path.resolve(__dirname, '..', 'prisma', 'schema.prisma');
const originalSchema = fs.readFileSync(schemaPath, 'utf8');
const lineEnding = originalSchema.includes('\r\n') ? '\r\n' : '\n';
let schema = originalSchema.replace(/\r\n/g, '\n');

function replaceOnce(search, replacement, label) {
  const first = schema.indexOf(search);
  if (first === -1) {
    throw new Error(`M2S2F1 schema sync failed: ${label} anchor not found.`);
  }
  if (schema.indexOf(search, first + search.length) !== -1) {
    throw new Error(`M2S2F1 schema sync failed: ${label} anchor is not unique.`);
  }
  schema = schema.replace(search, replacement);
}

if (schema.includes('model ClinicDayOperatingStaffAudit {')) {
  console.log('M2S2F1 Prisma schema is already synchronized.');
  process.exit(0);
}

replaceOnce(
  `enum PracticeStaffCapabilityStatus {\n  ACTIVE\n  REVOKED\n}\n`,
  `enum PracticeStaffCapabilityStatus {\n  ACTIVE\n  REVOKED\n}\n\nenum ClinicDayOperatingStaffChangeType {\n  ASSIGNED\n  REPLACED\n  CLEARED\n}\n`,
  'operating staff enum',
);

replaceOnce(
  `  cancelledClinicDays              ClinicDay[]                          @relation("ClinicDayCancelledByUser")\n`,
  `  cancelledClinicDays              ClinicDay[]                          @relation("ClinicDayCancelledByUser")\n  clinicDayOperatingStaffAudits    ClinicDayOperatingStaffAudit[]       @relation("ClinicDayOperatingStaffAuditActor")\n`,
  'User audit relation',
);

replaceOnce(
  `  clinicDays                   ClinicDay[]\n`,
  `  clinicDays                   ClinicDay[]\n  clinicDayOperatingStaffAudits ClinicDayOperatingStaffAudit[]\n`,
  'PracticeLocation audit relation',
);

replaceOnce(
  `  operatingClinicDays             ClinicDay[]               @relation("ClinicDayOperatingPracticeStaff")\n`,
  `  operatingClinicDays             ClinicDay[]                    @relation("ClinicDayOperatingPracticeStaff")\n  priorOperatingStaffAudits       ClinicDayOperatingStaffAudit[] @relation("ClinicDayOperatingStaffAuditPreviousStaff")\n  newOperatingStaffAudits         ClinicDayOperatingStaffAudit[] @relation("ClinicDayOperatingStaffAuditNewStaff")\n`,
  'PracticeStaff audit relations',
);

replaceOnce(
  `  operatingPracticeStaff PracticeStaff? @relation("ClinicDayOperatingPracticeStaff", fields: [operatingPracticeStaffId], references: [id], onDelete: Restrict)\n`,
  `  operatingPracticeStaff PracticeStaff? @relation("ClinicDayOperatingPracticeStaff", fields: [operatingPracticeStaffId], references: [id], onDelete: Restrict)\n\n  operatingStaffAudits ClinicDayOperatingStaffAudit[]\n`,
  'ClinicDay audit relation',
);

const auditModel = `model ClinicDayOperatingStaffAudit {\n  id String @id @default(uuid())\n\n  clinicDayId        String\n  practiceLocationId String\n  serviceDate        DateTime @db.Date\n\n  changeType ClinicDayOperatingStaffChangeType\n\n  previousOperatingPracticeStaffId String?\n  newOperatingPracticeStaffId      String?\n\n  actorUserId String\n\n  createdAt DateTime @default(now()) @db.Timestamptz(3)\n\n  clinicDay        ClinicDay        @relation(fields: [clinicDayId], references: [id], onDelete: Restrict)\n  practiceLocation PracticeLocation @relation(fields: [practiceLocationId], references: [id], onDelete: Restrict)\n\n  previousOperatingPracticeStaff PracticeStaff? @relation("ClinicDayOperatingStaffAuditPreviousStaff", fields: [previousOperatingPracticeStaffId], references: [id], onDelete: Restrict)\n  newOperatingPracticeStaff      PracticeStaff? @relation("ClinicDayOperatingStaffAuditNewStaff", fields: [newOperatingPracticeStaffId], references: [id], onDelete: Restrict)\n\n  actorUser User @relation("ClinicDayOperatingStaffAuditActor", fields: [actorUserId], references: [id], onDelete: Restrict)\n\n  @@index([clinicDayId, createdAt])\n  @@index([practiceLocationId, serviceDate, createdAt])\n  @@index([actorUserId, createdAt])\n  @@index([previousOperatingPracticeStaffId, createdAt])\n  @@index([newOperatingPracticeStaffId, createdAt])\n}\n\n`;

replaceOnce(
  `model QueueCounter {`,
  `${auditModel}model QueueCounter {`,
  'ClinicDayOperatingStaffAudit model insertion',
);

fs.writeFileSync(schemaPath, schema.replace(/\n/g, lineEnding), 'utf8');
console.log('M2S2F1 Prisma schema synchronization completed.');
