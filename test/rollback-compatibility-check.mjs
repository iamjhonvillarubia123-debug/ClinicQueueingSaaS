import 'dotenv/config';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, basename } from 'node:path';

const targetRef = process.argv[2];
if (!targetRef) {
  throw new Error(
    'Rollback target Git ref is required. Example: npm run verify:rollback -- <verified-previous-release-commit>',
  );
}

function git(args) {
  return execFileSync('git', args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

try {
  git(['rev-parse', '--verify', `${targetRef}^{commit}`]);
} catch {
  throw new Error(`Rollback target ref "${targetRef}" is not a valid local Git commit.`);
}

try {
  execFileSync('git', ['merge-base', '--is-ancestor', targetRef, 'HEAD'], {
    cwd: process.cwd(),
    stdio: 'ignore',
  });
} catch {
  throw new Error(
    `Rollback target ref "${targetRef}" is not an ancestor of the current release candidate.`,
  );
}

const registry = JSON.parse(
  readFileSync('ops/rollback-compatibility.json', 'utf8'),
);

if (registry.schemaVersion !== 1 || typeof registry.migrations !== 'object') {
  throw new Error('Rollback compatibility registry has an unsupported format.');
}

const diff = git([
  'diff',
  '--name-status',
  `${targetRef}...HEAD`,
  '--',
  'prisma/migrations',
]);

const changes = diff
  ? diff.split(/\r?\n/).map((line) => {
      const [status, path] = line.split(/\t/);
      return { status, path };
    })
  : [];

const unsafeEdits = changes.filter(({ status }) => status !== 'A');
if (unsafeEdits.length > 0) {
  throw new Error(
    `Application rollback compatibility cannot be approved because existing migration history changed: ${unsafeEdits
      .map(({ status, path }) => `${status} ${path}`)
      .join(', ')}`,
  );
}

const addedMigrationNames = [
  ...new Set(
    changes
      .map(({ path }) => path)
      .filter(Boolean)
      .map((path) => basename(dirname(path))),
  ),
];

const unclassified = [];
const incompatible = [];
for (const migrationName of addedMigrationNames) {
  const record = registry.migrations[migrationName];
  if (!record) {
    unclassified.push(migrationName);
    continue;
  }
  if (record.classification !== 'APPLICATION_ROLLBACK_COMPATIBLE') {
    incompatible.push(migrationName);
  }
}

if (unclassified.length > 0) {
  throw new Error(
    `Application rollback compatibility is unclassified for migration(s): ${unclassified.join(', ')}. Review migration rollback/recovery before deployment.`,
  );
}

if (incompatible.length > 0) {
  throw new Error(
    `Application-only rollback is not approved for migration(s): ${incompatible.join(', ')}. Use the documented database recovery path.`,
  );
}

console.log(`Rollback target verified: ${git(['rev-parse', targetRef])}`);
console.log(`Current release candidate: ${git(['rev-parse', 'HEAD'])}`);
if (addedMigrationNames.length === 0) {
  console.log('No database migrations were introduced since the rollback target.');
} else {
  console.log(
    `Application rollback compatibility PASS for ${addedMigrationNames.length} added migration(s): ${addedMigrationNames.join(', ')}.`,
  );
}
console.log(
  'Database downgrade is NOT implied by this result. Destructive/uncertain database recovery must use the pre-deployment backup/restore procedure.',
);
