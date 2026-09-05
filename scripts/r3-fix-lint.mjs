import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const filesToFormat = [
  'src/queue/close-clinic.service.ts',
  'src/queue/next-patient.service.ts',
  'src/queue/start-clinic.service.ts',
  'test/r3-cancel-clinic-day-authority.e2e-spec.ts',
  'test/r3-configuration-drafting-authority.e2e-spec.ts',
  'test/r3-operational-notice-authority-precedence.e2e-spec.ts',
  'test/r3-reinsert-return-authority-precedence.e2e-spec.ts',
  'test/r3-staff-appointment-authority-precedence.e2e-spec.ts',
  'test/r3-start-clinic-authority-precedence.e2e-spec.ts',
];

function replaceRequired(path, from, to, label) {
  const before = readFileSync(path, 'utf8');
  if (!before.includes(from)) {
    throw new Error(`Expected ${label} pattern was not found in ${path}.`);
  }
  const after = before.replace(from, to);
  writeFileSync(path, after, 'utf8');
}

replaceRequired(
  'test/r3-cancel-clinic-day-authority.e2e-spec.ts',
  '  NotificationType,\n',
  '',
  'unused NotificationType import',
);

replaceRequired(
  'test/r3-staff-appointment-authority-precedence.e2e-spec.ts',
  '      acquireCommandLock: async () => undefined,\n      findReplay: async () => null,',
  '      acquireCommandLock: () => Promise.resolve(undefined),\n      findReplay: () => Promise.resolve(null),',
  'non-awaiting async idempotency mocks',
);

const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const prettier = spawnSync(npx, ['prettier', '--write', ...filesToFormat], {
  stdio: 'inherit',
});

if (prettier.status !== 0) {
  process.exit(prettier.status ?? 1);
}

unlinkSync(fileURLToPath(import.meta.url));
console.log('R3 lint cleanup applied. One-time cleanup script removed itself.');
