import { execFileSync } from 'node:child_process';

execFileSync(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  [
    'prettier',
    '--write',
    'src/queue/close-clinic.service.ts',
    'src/queue/close-clinic.controller.ts',
  ],
  { stdio: 'inherit' },
);
