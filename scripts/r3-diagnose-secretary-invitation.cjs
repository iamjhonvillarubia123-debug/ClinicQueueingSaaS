require('dotenv').config();
const { Client } = require('pg');

function assertLocalDatabase(databaseUrl) {
  const parsed = new URL(databaseUrl);
  const localHosts = new Set(['localhost', '127.0.0.1', '::1']);
  if (!localHosts.has(parsed.hostname)) {
    throw new Error('Refusing diagnostics because DATABASE_URL is not local.');
  }
}

async function main() {
  const emailArg = process.argv[2];
  if (!emailArg) {
    throw new Error('Usage: node scripts/r3-diagnose-secretary-invitation.cjs <secretary-email>');
  }
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL environment variable is not defined.');
  }

  assertLocalDatabase(process.env.DATABASE_URL);
  const normalizedEmail = emailArg.trim().toLowerCase();
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    await client.query('BEGIN READ ONLY');
    const userResult = await client.query(
      `SELECT "email", "role", "accountStatus", "administrativeRestrictionStatus",
              "emailVerifiedAt", "firstName", "lastName"
         FROM "User"
        WHERE lower(trim("email")) = $1
        ORDER BY "createdAt" ASC`,
      [normalizedEmail],
    );
    const invitationResult = await client.query(
      `SELECT si."normalizedEmail", si."status", si."expiresAt", si."createdAt",
              si."requestedAssignmentType", si."requestedAuthorityBundles",
              pl."name" AS "clinicName"
         FROM "SecretaryInvitation" si
         JOIN "PracticeLocation" pl ON pl."id" = si."practiceLocationId"
        WHERE lower(trim(si."normalizedEmail")) = $1
        ORDER BY si."createdAt" DESC`,
      [normalizedEmail],
    );
    const now = new Date();
    const users = userResult.rows.map((row) => ({
      email: row.email,
      role: row.role,
      accountStatus: row.accountStatus,
      administrativeRestrictionStatus: row.administrativeRestrictionStatus,
      emailVerified: Boolean(row.emailVerifiedAt),
      firstName: row.firstName,
      lastName: row.lastName,
    }));
    const invitations = invitationResult.rows.map((row) => ({
      normalizedEmail: row.normalizedEmail,
      status: row.status,
      expired: new Date(row.expiresAt).getTime() <= now.getTime(),
      expiresAt: row.expiresAt,
      createdAt: row.createdAt,
      assignmentType: row.requestedAssignmentType,
      authorityBundles: row.requestedAuthorityBundles,
      clinicName: row.clinicName,
      shouldAppearInWorkspace:
        row.normalizedEmail.trim().toLowerCase() === normalizedEmail &&
        row.status === 'PENDING' &&
        new Date(row.expiresAt).getTime() > now.getTime(),
    }));

    console.log(
      JSON.stringify(
        {
          searchedEmail: normalizedEmail,
          userCount: users.length,
          users,
          invitationCount: invitations.length,
          invitations,
        },
        null,
        2,
      ),
    );
    await client.query('ROLLBACK');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
