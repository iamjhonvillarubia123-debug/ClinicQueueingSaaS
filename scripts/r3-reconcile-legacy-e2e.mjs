import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

function replaceRequired(path, from, to, label) {
  const before = readFileSync(path, 'utf8');
  if (!before.includes(from)) throw new Error(`Missing ${label} in ${path}`);
  writeFileSync(path, before.replace(from, to), 'utf8');
}

const startPath = 'test/start-clinic.e2e-spec.ts';
replaceRequired(
  startPath,
  "  let regularSecretaryUserId: string;\n",
  "  let regularSecretaryUserId: string;\n  let regularPracticeStaffId: string;\n",
  'regular staff id declaration',
);
replaceRequired(
  startPath,
  "    await prisma.practiceLocation.update({\n      where: { id: practiceLocationId },\n      data: { currentRegularPracticeStaffId: regularAssignment.id },\n    });",
  "    regularPracticeStaffId = regularAssignment.id;\n    await prisma.practiceLocation.update({\n      where: { id: practiceLocationId },\n      data: { currentRegularPracticeStaffId: regularAssignment.id },\n    });\n    const queueBundleNow = new Date();\n    await prisma.practiceStaffAuthorityBundle.create({\n      data: {\n        practiceStaffId: regularAssignment.id,\n        bundleType: 'QUEUE_AND_CLINIC_DAY_OPERATIONS',\n        status: 'ACTIVE',\n        grantedByUserId: doctorUserId,\n        grantedAt: queueBundleNow,\n        createdAt: queueBundleNow,\n      },\n    });",
  'regular queue authority fixture',
);
replaceRequired(
  startPath,
  "    expect(clinicDay.operatingPracticeStaffId).toBeNull();",
  "    expect(clinicDay.operatingPracticeStaffId).toBe(regularPracticeStaffId);",
  'doctor start operating secretary expectation',
);
replaceRequired(
  startPath,
  ").rejects.toThrow('No operating secretary is assigned');",
  ").rejects.toThrow(\n      'Secretary is not the current operating secretary for this clinic day.',\n    );",
  'other secretary rejection expectation',
);
replaceRequired(
  startPath,
  "  it('does not implicitly grant ClinicDay operating authority to the current regular secretary', async () => {\n    const serviceDate = '2026-08-27';\n\n    await expect(\n      service.start(\n        regularSecretaryUserId,\n        { practiceLocationId, serviceDate },\n        `regular-secretary-${scope}`,\n      ),\n    ).rejects.toThrow('No operating secretary is assigned');\n\n    const clinicDay = await prisma.clinicDay.findUnique({\n      where: {\n        practiceLocationId_serviceDate: {\n          practiceLocationId,\n          serviceDate: dateValue(serviceDate),\n        },\n      },\n    });\n    expect(clinicDay).toBeNull();\n  });",
  "  it('allows the current regular secretary with active queue authority to become the ClinicDay operator', async () => {\n    const serviceDate = '2026-08-27';\n\n    await expect(\n      service.start(\n        regularSecretaryUserId,\n        { practiceLocationId, serviceDate },\n        `regular-secretary-${scope}`,\n      ),\n    ).resolves.toMatchObject({ started: true, replayed: false });\n\n    const clinicDay = await prisma.clinicDay.findUniqueOrThrow({\n      where: {\n        practiceLocationId_serviceDate: {\n          practiceLocationId,\n          serviceDate: dateValue(serviceDate),\n        },\n      },\n    });\n    expect(clinicDay.operatingPracticeStaffId).toBe(regularPracticeStaffId);\n  });",
  'regular secretary legacy scenario',
);

const cancelPath = 'test/cancel-appointment.e2e-spec.ts';
replaceRequired(
  cancelPath,
  "    await prisma.practiceStaff.create({\n      data: {\n        userId: secretary.id,\n        practiceLocationId,\n        staffRole: PracticeStaffRole.SECRETARY,\n        isActive: true,\n      },\n    });",
  "    const assignedStaff = await prisma.practiceStaff.create({\n      data: {\n        userId: secretary.id,\n        practiceLocationId,\n        staffRole: PracticeStaffRole.SECRETARY,\n        isActive: true,\n      },\n    });\n    const intakeBundleNow = new Date();\n    await prisma.practiceStaffAuthorityBundle.create({\n      data: {\n        practiceStaffId: assignedStaff.id,\n        bundleType: 'APPOINTMENTS_AND_PATIENT_INTAKE',\n        status: 'ACTIVE',\n        grantedByUserId: doctorUserId,\n        grantedAt: intakeBundleNow,\n        createdAt: intakeBundleNow,\n      },\n    });",
  'appointment intake authority fixture',
);

unlinkSync(fileURLToPath(import.meta.url));
console.log('Legacy R3 E2E fixtures reconciled; one-time script removed.');
