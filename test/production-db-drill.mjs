import 'dotenv/config';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';

const { Client } = pg;

function requirePostgresUrl(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for the database drill.`);

  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid PostgreSQL URL.`);
  }

  if (!['postgresql:', 'postgres:'].includes(url.protocol)) {
    throw new Error(`${name} must be a PostgreSQL URL.`);
  }

  const database = url.pathname.replace(/^\/+/, '');
  if (!database) throw new Error(`${name} must name a database.`);

  return { value, url, database };
}

function assertSafeTestDatabase(test, development, shadow) {
  if (test.value === development.value || test.database === development.database) {
    throw new Error('Refusing database drill: TEST_DATABASE_URL targets the development database.');
  }

  if (test.value === shadow.value || test.database === shadow.database) {
    throw new Error('Refusing database drill: TEST_DATABASE_URL targets the Prisma shadow database.');
  }

  if (!/(^|[_-])test($|[_-])/i.test(test.database)) {
    throw new Error(
      `Refusing database drill: database name "${test.database}" is not explicitly test-designated.`,
    );
  }
}

function quotedIdentifier(value) {
  if (!/^[A-Za-z0-9_]+$/.test(value)) {
    throw new Error(`Unsafe generated database identifier: ${value}`);
  }
  return `"${value}"`;
}

function databaseUrl(baseUrl, database) {
  const url = new URL(baseUrl);
  url.pathname = `/${database}`;
  return url.toString();
}

function postgresCliUrl(baseUrl) {
  const url = new URL(baseUrl);
  // Prisma-specific connection parameters such as `schema` are not valid
  // libpq URI parameters and cause pg_dump/pg_restore to reject the URL.
  url.search = '';
  return url.toString();
}

function generatedDatabaseName(base, purpose, suffix) {
  const normalized = base.replace(/[^A-Za-z0-9_]/g, '_');
  const tail = `_${purpose}_${suffix}`;
  return `${normalized.slice(0, Math.max(1, 63 - tail.length))}${tail}`;
}

function runCommand(command, args, env = process.env) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env,
    stdio: 'inherit',
  });

  if (result.error) {
    if (result.error.code === 'ENOENT') {
      throw new Error(
        `${command} was not found. Install PostgreSQL client tools or add the PostgreSQL bin directory to PATH.`,
      );
    }
    throw result.error;
  }

  if ((result.status ?? 1) !== 0) {
    throw new Error(`${command} exited with status ${result.status ?? 1}.`);
  }
}

async function withClient(connectionString, action) {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    return await action(client);
  } finally {
    await client.end();
  }
}

async function createDatabase(maintenanceUrl, database) {
  await withClient(maintenanceUrl, async (client) => {
    await client.query(`CREATE DATABASE ${quotedIdentifier(database)}`);
  });
}

async function dropDatabaseIfExists(maintenanceUrl, database) {
  await withClient(maintenanceUrl, async (client) => {
    await client.query(
      'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()',
      [database],
    );
    await client.query(`DROP DATABASE IF EXISTS ${quotedIdentifier(database)}`);
  });
}

async function readTableCounts(connectionString) {
  return withClient(connectionString, async (client) => {
    const tables = await client.query(
      `SELECT tablename
       FROM pg_catalog.pg_tables
       WHERE schemaname = 'public'
       ORDER BY tablename`,
    );

    const counts = new Map();
    for (const row of tables.rows) {
      const tableName = String(row.tablename);
      const countResult = await client.query(
        `SELECT COUNT(*)::bigint AS count FROM ${quotedIdentifier(tableName)}`,
      );
      counts.set(tableName, String(countResult.rows[0].count));
    }
    return counts;
  });
}

function assertEqualTableCounts(source, restored) {
  const sourceEntries = [...source.entries()];
  const restoredEntries = [...restored.entries()];
  if (JSON.stringify(sourceEntries) !== JSON.stringify(restoredEntries)) {
    throw new Error('Backup/restore verification failed: restored table row counts differ from source.');
  }
}

async function assertMigrationHistoryHealthy(connectionString) {
  await withClient(connectionString, async (client) => {
    const result = await client.query(
      `SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE finished_at IS NULL AND rolled_back_at IS NULL)::int AS incomplete
       FROM "_prisma_migrations"`,
    );
    const row = result.rows[0];
    if (!row || Number(row.total) < 1 || Number(row.incomplete) !== 0) {
      throw new Error('Migration drill failed: Prisma migration history is missing or incomplete.');
    }
  });
}

const development = requirePostgresUrl('DATABASE_URL');
const shadow = requirePostgresUrl('SHADOW_DATABASE_URL');
const test = requirePostgresUrl('TEST_DATABASE_URL');
assertSafeTestDatabase(test, development, shadow);

const suffix = randomUUID().replaceAll('-', '').slice(0, 8);
const migrationDatabase = generatedDatabaseName(test.database, 'm13mig', suffix);
const restoreDatabase = generatedDatabaseName(test.database, 'm13restore', suffix);
const maintenanceUrl = databaseUrl(test.value, 'postgres');
const migrationUrl = databaseUrl(test.value, migrationDatabase);
const restoreUrl = databaseUrl(test.value, restoreDatabase);
const testCliUrl = postgresCliUrl(test.value);
const restoreCliUrl = postgresCliUrl(restoreUrl);
const dumpPath = join(tmpdir(), `clinic-queueing-m13-${suffix}.dump`);

console.log(`Database drill source verified: ${test.database}`);
console.log(`Fresh-migration target: ${migrationDatabase}`);
console.log(`Restore target: ${restoreDatabase}`);

try {
  await dropDatabaseIfExists(maintenanceUrl, migrationDatabase);
  await dropDatabaseIfExists(maintenanceUrl, restoreDatabase);

  console.log('1/5 Creating fresh migration target...');
  await createDatabase(maintenanceUrl, migrationDatabase);

  console.log('2/5 Applying all Prisma migrations to an empty database...');
  runCommand(
    process.execPath,
    ['./node_modules/prisma/build/index.js', 'migrate', 'deploy'],
    { ...process.env, DATABASE_URL: migrationUrl, NODE_ENV: 'test' },
  );
  await assertMigrationHistoryHealthy(migrationUrl);

  console.log('3/5 Creating PostgreSQL custom-format backup of the isolated test database...');
  runCommand('pg_dump', [
    '--format=custom',
    '--no-owner',
    '--no-privileges',
    '--file',
    dumpPath,
    testCliUrl,
  ]);

  const sourceCounts = await readTableCounts(test.value);

  console.log('4/5 Restoring backup into a separate temporary database...');
  await createDatabase(maintenanceUrl, restoreDatabase);
  runCommand('pg_restore', [
    '--exit-on-error',
    '--no-owner',
    '--no-privileges',
    '--dbname',
    restoreCliUrl,
    dumpPath,
  ]);

  const restoredCounts = await readTableCounts(restoreUrl);
  assertEqualTableCounts(sourceCounts, restoredCounts);
  await assertMigrationHistoryHealthy(restoreUrl);

  console.log('5/5 Confirming restored database is current with repository migrations...');
  runCommand(
    process.execPath,
    ['./node_modules/prisma/build/index.js', 'migrate', 'deploy'],
    { ...process.env, DATABASE_URL: restoreUrl, NODE_ENV: 'test' },
  );

  console.log(
    `M13 database drill PASS: clean migration and backup/restore verified across ${sourceCounts.size} public tables.`,
  );
} finally {
  await dropDatabaseIfExists(maintenanceUrl, migrationDatabase).catch(() => undefined);
  await dropDatabaseIfExists(maintenanceUrl, restoreDatabase).catch(() => undefined);
  rmSync(dumpPath, { force: true });
}
