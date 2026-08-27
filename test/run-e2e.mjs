import 'dotenv/config';
import { spawnSync } from 'node:child_process';

function requireUrl(name) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} is required for E2E database isolation.`);
  }

  let url;

  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid PostgreSQL URL.`);
  }

  if (!['postgresql:', 'postgres:'].includes(url.protocol)) {
    throw new Error(`${name} must be a PostgreSQL URL.`);
  }

  return { value, url };
}

const development = requireUrl('DATABASE_URL');
const shadow = requireUrl('SHADOW_DATABASE_URL');
const test = requireUrl('TEST_DATABASE_URL');

const developmentDatabase = development.url.pathname.replace(/^\/+/, '');
const shadowDatabase = shadow.url.pathname.replace(/^\/+/, '');
const testDatabase = test.url.pathname.replace(/^\/+/, '');

if (test.value === development.value || testDatabase === developmentDatabase) {
  throw new Error(
    'Refusing E2E execution: TEST_DATABASE_URL targets the development database.',
  );
}

if (test.value === shadow.value || testDatabase === shadowDatabase) {
  throw new Error(
    'Refusing E2E execution: TEST_DATABASE_URL targets the Prisma shadow database.',
  );
}

if (!/(^|[_-])test($|[_-])/i.test(testDatabase)) {
  throw new Error(
    `Refusing E2E execution: test database name "${testDatabase}" is not explicitly test-designated.`,
  );
}

console.log(`E2E database isolation verified: ${testDatabase}`);

const env = {
  ...process.env,
  DATABASE_URL: test.value,
  NODE_ENV: 'test',
  RATE_LIMIT_ENABLED: 'false',
};

const migration = spawnSync(
  process.execPath,
  ['./node_modules/prisma/build/index.js', 'migrate', 'deploy'],
  {
    cwd: process.cwd(),
    env,
    stdio: 'inherit',
  },
);

if (migration.error) {
  throw migration.error;
}

if ((migration.status ?? 1) !== 0) {
  process.exit(migration.status ?? 1);
}

const requestedArguments = process.argv.slice(2);
const explicitlyRunsLoadTest = requestedArguments.some((argument) =>
  argument.includes('performance-load.e2e-spec.ts'),
);
const jestArguments = explicitlyRunsLoadTest
  ? requestedArguments
  : [
      '--testPathIgnorePatterns=performance-load.e2e-spec.ts',
      ...requestedArguments,
    ];

const result = spawnSync(
  process.execPath,
  [
    '--experimental-vm-modules',
    './node_modules/jest/bin/jest.js',
    '--config',
    './test/jest-e2e.json',
    ...jestArguments,
  ],
  {
    cwd: process.cwd(),
    env,
    stdio: 'inherit',
  },
);

if (result.error) {
  throw result.error;
}

process.exit(result.status ?? 1);
