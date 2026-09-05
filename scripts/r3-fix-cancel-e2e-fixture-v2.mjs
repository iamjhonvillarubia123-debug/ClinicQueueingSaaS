import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const path = 'test/cancel-appointment.e2e-spec.ts';
const before = readFileSync(path, 'utf8');

if (before.includes("bundleType: 'APPOINTMENTS_AND_PATIENT_INTAKE'")) {
  console.log('Cancellation authority fixture already reconciled.');
  unlinkSync(fileURLToPath(import.meta.url));
  process.exit(0);
}

const marker = '    secretaryUserId = secretary.id;';
const markerIndex = before.indexOf(marker);
if (markerIndex < 0) {
  throw new Error('Assigned Secretary marker not found.');
}

const createStart = before.indexOf('    await prisma.practiceStaff.create({', markerIndex);
if (createStart < 0) {
  throw new Error('Assigned Secretary PracticeStaff fixture not found.');
}
const createEndMarker = '    });';
const createEnd = before.indexOf(createEndMarker, createStart);
if (createEnd < 0) {
  throw new Error('Assigned Secretary PracticeStaff fixture end not found.');
}
const blockEnd = createEnd + createEndMarker.length;
const originalBlock = before.slice(createStart, blockEnd);
const staffBlock = originalBlock.replace(
  '    await prisma.practiceStaff.create({',
  '    const assignedStaff = await prisma.practiceStaff.create({',
);
const replacement = `${staffBlock}\n    const intakeBundleNow = new Date();\n    await prisma.practiceStaffAuthorityBundle.create({\n      data: {\n        practiceStaffId: assignedStaff.id,\n        bundleType: 'APPOINTMENTS_AND_PATIENT_INTAKE',\n        status: 'ACTIVE',\n        grantedByUserId: doctorUserId,\n        grantedAt: intakeBundleNow,\n        createdAt: intakeBundleNow,\n      },\n    });`;

const after = before.slice(0, createStart) + replacement + before.slice(blockEnd);
writeFileSync(path, after, 'utf8');
unlinkSync(fileURLToPath(import.meta.url));
console.log('Cancellation authority fixture reconciled; one-time script removed.');
