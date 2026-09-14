require('dotenv').config();
const { Client } = require('pg');
const { assertDevelopmentDatabase } = require('./show-dev-latest-email-verification-link.cjs');

async function main() {
  console.log('R3 recent Secretary account diagnostic');
  console.log('Read-only: no rows are changed.');

  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to inspect Secretary account lifecycle state in production.');
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is not defined.');
  assertDevelopmentDatabase(databaseUrl);

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const result = await client.query(`
      SELECT
        u."id",
        u."firstName",
        u."lastName",
        u."role",
        u."accountStatus",
        u."administrativeRestrictionStatus",
        u."loginIdentifierType",
        u."email",
        u."emailVerifiedAt",
        u."mobileNumberHash",
        u."mobileVerifiedAt",
        u."createdAt",
        u."updatedAt",
        EXISTS (
          SELECT 1
          FROM "AccountPermanentClosureAudit" apca
          WHERE apca."accountUserId" = u."id"
        ) AS "hasPermanentClosureAudit"
      FROM "User" u
      WHERE u."role" = 'SECRETARY'
      ORDER BY u."updatedAt" DESC, u."createdAt" DESC
      LIMIT 20
    `);

    console.log(`Recent Secretary rows: ${result.rowCount}`);
    for (const row of result.rows) {
      const name = [row.firstName, row.lastName].filter(Boolean).join(' ') || '(no name)';
      const maskedEmail = row.email
        ? row.email.replace(/^(.).+(@.*)$/, '$1***$2')
        : 'NULL';
      console.log(`\n${name}`);
      console.log(`  userId: ${row.id}`);
      console.log(`  accountStatus: ${row.accountStatus}`);
      console.log(`  administrativeRestrictionStatus: ${row.administrativeRestrictionStatus}`);
      console.log(`  loginIdentifierType: ${row.loginIdentifierType}`);
      console.log(`  email: ${maskedEmail}`);
      console.log(`  emailVerified: ${row.emailVerifiedAt ? 'YES' : 'NO'}`);
      console.log(`  mobileHashPresent: ${row.mobileNumberHash ? 'YES' : 'NO'}`);
      console.log(`  mobileVerified: ${row.mobileVerifiedAt ? 'YES' : 'NO'}`);
      console.log(`  permanentClosureAudit: ${row.hasPermanentClosureAudit ? 'YES' : 'NO'}`);
      console.log(`  createdAt: ${row.createdAt.toISOString()}`);
      console.log(`  updatedAt: ${row.updatedAt.toISOString()}`);
    }
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
