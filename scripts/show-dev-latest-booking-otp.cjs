require('dotenv').config();
const { createHmac } = require('crypto');
const { Client } = require('pg');

function assertDevelopmentDatabase(databaseUrl) {
  const parsed = new URL(databaseUrl);
  const localHosts = new Set(['localhost', '127.0.0.1', '::1']);
  const databaseName = parsed.pathname.replace(/^\//, '');

  if (process.env.NODE_ENV && process.env.NODE_ENV !== 'development') {
    throw new Error(
      'Refusing to reveal a booking OTP because NODE_ENV is not development.',
    );
  }
  if (!localHosts.has(parsed.hostname)) {
    throw new Error(
      'Refusing to reveal a booking OTP because DATABASE_URL is not local.',
    );
  }
  if (!/(^|_)dev($|_)/i.test(databaseName)) {
    throw new Error(
      'Refusing to reveal a booking OTP because the database name is not development-scoped.',
    );
  }
}

async function printMissingOtpDiagnostic(client) {
  const dbNowResult = await client.query('SELECT now() AS "databaseNow"');
  const databaseNow = dbNowResult.rows[0].databaseNow;
  const nodeNow = new Date();

  const draftResult = await client.query(`
    SELECT
      "id",
      "status"::text AS "status",
      "expiresAt",
      "expiredAt",
      "privacyNoticeAcknowledgedAt",
      "consumedAt",
      "cancelledAt",
      "activeDraftKey" IS NOT NULL AS "hasActiveDraftKey",
      "createdAt",
      "updatedAt"
    FROM "BookingDraft"
    ORDER BY "createdAt" DESC
    LIMIT 1
  `);

  console.error(`Node now: ${nodeNow.toISOString()}`);
  console.error(`Database now: ${new Date(databaseNow).toISOString()}`);

  if (draftResult.rowCount === 0) {
    console.error('Diagnostic: no BookingDraft exists in this development database.');
    console.error('The browser did not successfully create a booking draft.');
    return;
  }

  const draft = draftResult.rows[0];
  console.error('Diagnostic: a BookingDraft exists, but no active unverified OTP is available.');
  console.error(`Latest draft created: ${new Date(draft.createdAt).toISOString()}`);
  console.error(`Latest draft updated: ${new Date(draft.updatedAt).toISOString()}`);
  console.error(`Latest draft expires: ${new Date(draft.expiresAt).toISOString()}`);
  console.error(`Latest draft status: ${draft.status}`);
  console.error(`Draft expired by Node clock: ${new Date(draft.expiresAt) <= nodeNow ? 'yes' : 'no'}`);
  console.error(`Draft expired by database clock: ${new Date(draft.expiresAt) <= new Date(databaseNow) ? 'yes' : 'no'}`);
  console.error(`Draft expiredAt recorded: ${draft.expiredAt ? new Date(draft.expiredAt).toISOString() : 'no'}`);
  console.error(`Active draft key present: ${draft.hasActiveDraftKey ? 'yes' : 'no'}`);
  console.error(`Privacy acknowledged: ${draft.privacyNoticeAcknowledgedAt ? 'yes' : 'no'}`);
  console.error(`Draft consumed: ${draft.consumedAt ? 'yes' : 'no'}`);
  console.error(`Draft cancelled: ${draft.cancelledAt ? 'yes' : 'no'}`);

  const otpResult = await client.query(`
    SELECT
      "otpHash" IS NOT NULL AS "hasOtpHash",
      "expiresAt",
      "verifiedAt",
      "consumedAt",
      "invalidatedAt",
      "createdAt"
    FROM "OtpVerification"
    WHERE "bookingDraftId" = $1
      AND "purpose"='BOOKING'::"OtpPurpose"
    ORDER BY "createdAt" DESC
    LIMIT 1
  `, [draft.id]);

  if (otpResult.rowCount === 0) {
    console.error('OTP history for latest draft: none.');
    console.error('The draft was created but never became eligible for OTP issuance.');
    return;
  }

  const otp = otpResult.rows[0];
  console.error(`OTP created: ${new Date(otp.createdAt).toISOString()}`);
  console.error(`OTP expires: ${new Date(otp.expiresAt).toISOString()}`);
  console.error('OTP history exists: yes');
  console.error(`OTP hash present: ${otp.hasOtpHash ? 'yes' : 'no'}`);
  console.error(`OTP expired by Node clock: ${new Date(otp.expiresAt) <= nodeNow ? 'yes' : 'no'}`);
  console.error(`OTP expired by database clock: ${new Date(otp.expiresAt) <= new Date(databaseNow) ? 'yes' : 'no'}`);
  console.error(`OTP verified: ${otp.verifiedAt ? 'yes' : 'no'}`);
  console.error(`OTP consumed: ${otp.consumedAt ? 'yes' : 'no'}`);
  console.error(`OTP invalidated: ${otp.invalidatedAt ? 'yes' : 'no'}`);
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL environment variable is not defined.');
  }
  if (!process.env.OTP_HMAC_KEY_V1) {
    throw new Error('OTP_HMAC_KEY_V1 environment variable is not defined.');
  }

  assertDevelopmentDatabase(process.env.DATABASE_URL);

  const key = Buffer.from(process.env.OTP_HMAC_KEY_V1, 'base64');
  if (key.length !== 32) {
    throw new Error('OTP_HMAC_KEY_V1 must decode to exactly 32 bytes.');
  }

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    const result = await client.query(`
      SELECT "bookingDraftId", "otpHash", "expiresAt"
      FROM "OtpVerification"
      WHERE "purpose"='BOOKING'::"OtpPurpose"
        AND "otpHash" IS NOT NULL
        AND "invalidatedAt" IS NULL
        AND "consumedAt" IS NULL
        AND "verifiedAt" IS NULL
        AND "expiresAt" > now()
      ORDER BY "createdAt" DESC
      LIMIT 1
    `);

    if (result.rowCount === 0) {
      await printMissingOtpDiagnostic(client);
      throw new Error(
        'No active unverified booking OTP exists. Use the diagnostic above to identify the failed stage.',
      );
    }

    const { bookingDraftId, otpHash, expiresAt } = result.rows[0];
    let otp = null;

    for (let value = 0; value <= 999999; value += 1) {
      const candidate = String(value).padStart(6, '0');
      const hash = createHmac('sha256', key)
        .update(`${bookingDraftId}:BOOKING:${candidate}`, 'utf8')
        .digest('hex');

      if (hash === otpHash) {
        otp = candidate;
        break;
      }
    }

    if (!otp) {
      throw new Error('Unable to recover the active development OTP.');
    }

    console.log('Development booking OTP ready.');
    console.log(`OTP: ${otp}`);
    console.log(`Expires at: ${new Date(expiresAt).toISOString()}`);
    console.log(
      'Development-only diagnostic. Never use this mechanism in production.',
    );
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
