import 'dotenv/config';
import { spawnSync } from 'node:child_process';

function requireUrl(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required.`);
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
  throw new Error('Refusing reset: TEST_DATABASE_URL targets the development database.');
}

if (test.value === shadow.value || testDatabase === shadowDatabase) {
  throw new Error('Refusing reset: TEST_DATABASE_URL targets the Prisma shadow database.');
}

if (!/(^|[_-])test($|[_-])/i.test(testDatabase)) {
  throw new Error(
    `Refusing reset: test database name "${testDatabase}" is not explicitly test-designated.`,
  );
}

console.log(`Resetting isolated E2E database: ${testDatabase}`);

const result = spawnSync(
  process.execPath,
  ['./node_modules/prisma/build/index.js', 'migrate', 'reset', '--force'],
  {
    cwd: process.cwd(),
    env: {
      ...process.env,
      DATABASE_URL: test.value,
      NODE_ENV: 'test',
    },
    stdio: 'inherit',
  },
);

if (result.error) {
  throw result.error;
}

process.exit(result.status ?? 1);
