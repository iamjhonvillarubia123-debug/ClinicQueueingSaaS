import { readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

const path = 'test/next-patient.e2e-spec.ts';
let source = await readFile(path, 'utf8');

const replacements = [
  {
    pattern: /expect\(events\[0\]\?\.queueEventSequence\)\.toBe\(1\);/g,
    replacement: 'expect(events[0]?.queueEventSequence).toBe(1n);',
    label: 'queue event sequence 1 bigint assertion',
  },
  {
    pattern: /expect\(events\[1\]\?\.queueEventSequence\)\.toBe\(2\);/g,
    replacement: 'expect(events[1]?.queueEventSequence).toBe(2n);',
    label: 'queue event sequence 2 bigint assertion',
  },
];

for (const { pattern, replacement, label } of replacements) {
  const matches = source.match(pattern);
  if (!matches || matches.length !== 1) {
    throw new Error(`${label}: expected exactly one match, found ${matches?.length ?? 0}`);
  }
  source = source.replace(pattern, replacement);
}

await writeFile(path, source, 'utf8');

const prettier = spawnSync(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['prettier', '--write', path],
  { stdio: 'inherit' },
);

if (prettier.error) {
  throw prettier.error;
}
if (prettier.status !== 0) {
  throw new Error(`Prettier failed with exit code ${prettier.status}`);
}

console.log('M7S2 NEXT PATIENT E2E bigint assertions and formatting finalized.');
