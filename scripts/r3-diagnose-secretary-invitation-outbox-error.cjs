require('dotenv').config();
const { Client } = require('pg');

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL environment variable is not defined.');
  }

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    const result = await client.query(`
      SELECT
        n.nspname AS schema_name,
        t.relname AS table_name,
        c.conname AS constraint_name,
        pg_get_constraintdef(c.oid, true) AS definition
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE n.nspname = 'public'
        AND t.relname = 'NotificationOutbox'
      ORDER BY c.contype, c.conname;
    `);

    console.log('All NotificationOutbox constraints in the running database:\n');
    for (const row of result.rows) {
      console.log(`--- ${row.constraint_name} ---`);
      console.log(row.definition);
      console.log();
    }

    const indexes = await client.query(`
      SELECT indexname, indexdef
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename = 'NotificationOutbox'
      ORDER BY indexname;
    `);

    console.log('NotificationOutbox indexes in the running database:\n');
    for (const row of indexes.rows) {
      console.log(`--- ${row.indexname} ---`);
      console.log(row.indexdef);
      console.log();
    }
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
