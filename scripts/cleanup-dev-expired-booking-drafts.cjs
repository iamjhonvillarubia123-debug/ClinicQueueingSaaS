require('dotenv').config();
const { Client } = require('pg');

function assertDevelopmentDatabase(databaseUrl) {
  const parsed = new URL(databaseUrl);
  const localHosts = new Set(['localhost', '127.0.0.1', '::1']);
  const databaseName = parsed.pathname.replace(/^\//, '');

  if (process.env.NODE_ENV && process.env.NODE_ENV !== 'development') {
    throw new Error(
      'Refusing to clean booking drafts because NODE_ENV is not development.',
    );
  }
  if (!localHosts.has(parsed.hostname)) {
    throw new Error(
      'Refusing to clean booking drafts because DATABASE_URL is not local.',
    );
  }
  if (!/(^|_)dev($|_)/i.test(databaseName)) {
    throw new Error(
      'Refusing to clean booking drafts because the database name is not development-scoped.',
    );
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
    await client.query('BEGIN');

    const expired = await client.query(`
      UPDATE "BookingDraft"
      SET
        "status" = 'EXPIRED'::"BookingDraftStatus",
        "expiredAt" = COALESCE("expiredAt", now()),
        "activeDraftKey" = NULL,
        "updatedAt" = now()
      WHERE "status" = 'PENDING_OTP'::"BookingDraftStatus"
        AND "expiresAt" <= now()
      RETURNING "id"
    `);

    await client.query(`
      UPDATE "OtpVerification"
      SET
        "invalidatedAt" = COALESCE("invalidatedAt", now()),
        "activeContextKey" = NULL,
        "otpHash" = NULL,
        "updatedAt" = now()
      WHERE "purpose" = 'BOOKING'::"OtpPurpose"
        AND "verifiedAt" IS NULL
        AND "consumedAt" IS NULL
        AND "expiresAt" <= now()
    `);

    await client.query('COMMIT');

    console.log('Development booking cleanup completed.');
    console.log(`Expired drafts terminalized: ${expired.rowCount}`);
    console.log('Expired unverified OTP challenges invalidated.');
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
