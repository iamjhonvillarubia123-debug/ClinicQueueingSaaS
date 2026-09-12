require('dotenv').config();
const { Client } = require('pg');

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL environment variable is not defined.');
  }

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    const outbox = await client.query(`
      SELECT
        c.conname AS constraint_name,
        pg_get_constraintdef(c.oid, true) AS definition
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE n.nspname = 'public'
        AND t.relname = 'NotificationOutbox'
        AND c.contype = 'c'
      ORDER BY c.conname;
    `);

    console.log('NotificationOutbox CHECK constraints in the running database:\n');
    for (const row of outbox.rows) {
      console.log(`--- ${row.constraint_name} ---`);
      console.log(row.definition);
      console.log();
    }

    const invitations = await client.query(`
      SELECT
        c.conname AS constraint_name,
        pg_get_constraintdef(c.oid, true) AS definition
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE n.nspname = 'public'
        AND t.relname = 'SecretaryInvitation'
        AND c.contype = 'c'
      ORDER BY c.conname;
    `);

    console.log('SecretaryInvitation CHECK constraints in the running database:\n');
    for (const row of invitations.rows) {
      console.log(`--- ${row.constraint_name} ---`);
      console.log(row.definition);
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
