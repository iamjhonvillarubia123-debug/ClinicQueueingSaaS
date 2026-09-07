const { PrismaClient } = require('../generated/prisma/client');

const prisma = new PrismaClient();

async function main() {
  const rows = await prisma.$queryRawUnsafe(`
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
  for (const row of rows) {
    console.log(`--- ${row.constraint_name} ---`);
    console.log(row.definition);
    console.log();
  }

  const invitationRows = await prisma.$queryRawUnsafe(`
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
  for (const row of invitationRows) {
    console.log(`--- ${row.constraint_name} ---`);
    console.log(row.definition);
    console.log();
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
