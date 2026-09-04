require('dotenv').config();
const { randomBytes, randomUUID } = require('crypto');
const bcrypt = require('bcrypt');
const { Client } = require('pg');

const ACCEPTANCE_EMAIL = 'frontend.acceptance.doctor@local.test';
const ACCEPTANCE_MOBILE = '+639000000000';
const BCRYPT_SALT_ROUNDS = 12;

async function main() {
  if (process.env.NODE_ENV && process.env.NODE_ENV !== 'development') {
    throw new Error(
      'Refusing to create the acceptance user because NODE_ENV is not development.',
    );
  }

  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL environment variable is not defined.');
  }

  const temporaryPassword = `F0-${randomBytes(18).toString('base64url')}`;
  const passwordHash = await bcrypt.hash(temporaryPassword, BCRYPT_SALT_ROUNDS);
  const now = new Date();
  const client = new Client({ connectionString: process.env.DATABASE_URL });

  await client.connect();
  try {
    await client.query('BEGIN');

    const existing = await client.query(
      'SELECT "id" FROM "User" WHERE "email" = $1 LIMIT 1 FOR UPDATE',
      [ACCEPTANCE_EMAIL],
    );

    let userId;
    if (existing.rowCount > 0) {
      userId = existing.rows[0].id;
      await client.query(
        `UPDATE "User"
         SET "firstName" = $2,
             "middleName" = NULL,
             "lastName" = $3,
             "mobileNumber" = $4,
             "passwordHash" = $5,
             "role" = 'DOCTOR'::"UserRole",
             "accountStatus" = 'ACTIVE'::"UserAccountStatus",
             "administrativeRestrictionStatus" = 'NONE'::"AdministrativeRestrictionStatus",
             "emailVerifiedAt" = $6,
             "updatedAt" = $6
         WHERE "id" = $1`,
        [userId, 'Frontend', 'Acceptance', ACCEPTANCE_MOBILE, passwordHash, now],
      );
    } else {
      userId = randomUUID();
      await client.query(
        `INSERT INTO "User" (
           "id", "email", "firstName", "middleName", "lastName",
           "mobileNumber", "passwordHash", "role", "accountStatus",
           "administrativeRestrictionStatus", "emailVerifiedAt",
           "createdAt", "updatedAt"
         ) VALUES (
           $1, $2, $3, NULL, $4, $5, $6,
           'DOCTOR'::"UserRole", 'ACTIVE'::"UserAccountStatus",
           'NONE'::"AdministrativeRestrictionStatus", $7, $7, $7
         )`,
        [
          userId,
          ACCEPTANCE_EMAIL,
          'Frontend',
          'Acceptance',
          ACCEPTANCE_MOBILE,
          passwordHash,
          now,
        ],
      );
    }

    await client.query(
      `UPDATE "UserSession"
       SET "revokedAt" = $2
       WHERE "userId" = $1 AND "revokedAt" IS NULL`,
      [userId, now],
    );

    await client.query('COMMIT');

    console.log('Development acceptance user ready.');
    console.log(`Email: ${ACCEPTANCE_EMAIL}`);
    console.log(`Temporary password: ${temporaryPassword}`);
    console.log('Role: DOCTOR');
    console.log(
      'This password is generated locally and is not stored in the repository.',
    );
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
