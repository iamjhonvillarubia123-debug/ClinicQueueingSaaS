import { readFileSync, writeFileSync } from 'node:fs';

const path = 'test/cancel-appointment.e2e-spec.ts';
let source = readFileSync(path, 'utf8');

function replaceRequired(label, before, after) {
  if (!source.includes(before)) {
    throw new Error(`${label}: expected source pattern was not found`);
  }
  source = source.replace(before, after);
}

replaceRequired(
  'doctor mobile fixture',
  "      mobileNumberEncrypted: 'encrypted-mobile-e2e',\n",
  "      mobileNumberEncrypted: 'encrypted-mobile-e2e',\n" +
    "      mobileNumberHash: createHash('sha256')\n" +
    "        .update(`m7-cancel-mobile-${scope}-41`)\n" +
    "        .digest('hex'),\n" +
    "      mobileNumberLastFour: '1234',\n",
);

replaceRequired(
  'temporarily absent order fixture',
  "    const appointment = await createAppointment('2026-10-02', 42, {\n      status: AppointmentStatus.TEMPORARILY_ABSENT,\n    });",
  "    const appointment = await createAppointment('2026-10-02', 42, {\n      status: AppointmentStatus.TEMPORARILY_ABSENT,\n      servingOrderKey: null,\n      waitingPlacementType: null,\n    });",
);

writeFileSync(path, source, 'utf8');
console.log('M7S5B1 cancellation E2E fixtures aligned.');
