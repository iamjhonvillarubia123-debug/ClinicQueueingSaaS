require('dotenv').config();
const { Client } = require('pg');

function assertDevelopmentDatabase(databaseUrl) {
  const parsed = new URL(databaseUrl);
  const localHosts = new Set(['localhost', '127.0.0.1', '::1']);
  const databaseName = parsed.pathname.replace(/^\//, '');

  if (process.env.NODE_ENV && process.env.NODE_ENV !== 'development') {
    throw new Error('Refusing timestamp diagnostics because NODE_ENV is not development.');
  }
  if (!localHosts.has(parsed.hostname)) {
    throw new Error('Refusing timestamp diagnostics because DATABASE_URL is not local.');
  }
  if (!/(^|_)dev($|_)/i.test(databaseName)) {
    throw new Error('Refusing timestamp diagnostics because the database name is not development-scoped.');
  }
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL environment variable is not defined.');
  }
  assertDevelopmentDatabase(process.env.DATABASE_URL);

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    const session = await client.query(`
      SELECT
        now() AS "databaseNow",
        current_setting('TimeZone') AS "sessionTimeZone"
    `);

    const columns = await client.query(`
      SELECT
        table_name AS "tableName",
        column_name AS "columnName",
        data_type AS "dataType",
        udt_name AS "udtName"
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name IN ('BookingDraft', 'OtpVerification')
        AND column_name IN ('createdAt', 'updatedAt', 'expiresAt', 'expiredAt')
      ORDER BY table_name, ordinal_position
    `);

    console.log(`Node now: ${new Date().toISOString()}`);
    console.log(`Database now: ${new Date(session.rows[0].databaseNow).toISOString()}`);
    console.log(`Database session timezone: ${session.rows[0].sessionTimeZone}`);
    console.log('Timestamp column types:');
    for (const row of columns.rows) {
      console.log(`${row.tableName}.${row.columnName}: ${row.dataType} (${row.udtName})`);
    }
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
