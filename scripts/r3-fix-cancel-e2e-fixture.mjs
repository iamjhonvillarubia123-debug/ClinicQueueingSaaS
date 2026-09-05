import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const path = 'test/cancel-appointment.e2e-spec.ts';
const before = readFileSync(path, 'utf8');
const from = `    await prisma.practiceStaff.create({\n      data: {\n        userId: secretary.id,\n        practiceLocationId,\n        staffRole: PracticeStaffRole.SECRETARY,\n        isActive: true,\n      },\n    });`;
const to = `    const assignedStaff = await prisma.practiceStaff.create({\n      data: {\n        userId: secretary.id,\n        practiceLocationId,\n        staffRole: PracticeStaffRole.SECRETARY,\n        isActive: true,\n      },\n    });\n    const intakeBundleNow = new Date();\n    await prisma.practiceStaffAuthorityBundle.create({\n      data: {\n        practiceStaffId: assignedStaff.id,\n        bundleType: 'APPOINTMENTS_AND_PATIENT_INTAKE',\n        status: 'ACTIVE',\n        grantedByUserId: doctorUserId,\n        grantedAt: intakeBundleNow,\n        createdAt: intakeBundleNow,\n      },\n    });`;

if (!before.includes(from)) {
  throw new Error('Assigned Secretary fixture shape changed; cancellation authority patch was not applied.');
}

writeFileSync(path, before.replace(from, to), 'utf8');
unlinkSync(fileURLToPath(import.meta.url));
console.log('Cancellation E2E authority fixture updated; one-time helper removed.');
