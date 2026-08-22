require('dotenv').config();
const { createHmac } = require('crypto');
const { Client } = require('pg');

function assertDevelopmentDatabase(databaseUrl) {
  const parsed = new URL(databaseUrl);
  const localHosts = new Set(['localhost', '127.0.0.1', '::1']);
  const databaseName = parsed.pathname.replace(/^\//, '');

  if (process.env.NODE_ENV && process.env.NODE_ENV !== 'development') {
    throw new Error('Refusing to reveal an appointment recovery OTP because NODE_ENV is not development.');
  }
  if (!localHosts.has(parsed.hostname)) {
    throw new Error('Refusing to reveal an appointment recovery OTP because DATABASE_URL is not local.');
  }
  if (!/(^|_)dev($|_)/i.test(databaseName)) {
    throw new Error('Refusing to reveal an appointment recovery OTP because the database name is not development-scoped.');
  }
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL environment variable is not defined.');
  if (!process.env.OTP_HMAC_KEY_V1) throw new Error('OTP_HMAC_KEY_V1 environment variable is not defined.');

  assertDevelopmentDatabase(process.env.DATABASE_URL);
  const key = Buffer.from(process.env.OTP_HMAC_KEY_V1, 'base64');
  if (key.length !== 32) throw new Error('OTP_HMAC_KEY_V1 must decode to exactly 32 bytes.');

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const result = await client.query(`
      SELECT "bookingRecoveryAttemptId", "otpHash", "expiresAt"
      FROM "OtpVerification"
      WHERE "purpose"='APPOINTMENT_RECOVERY'::"OtpPurpose"
        AND "bookingRecoveryAttemptId" IS NOT NULL
        AND "otpHash" IS NOT NULL
        AND "invalidatedAt" IS NULL
        AND "consumedAt" IS NULL
        AND "verifiedAt" IS NULL
        AND "expiresAt" > now()
      ORDER BY "createdAt" DESC
      LIMIT 1
    `);

    if (result.rowCount === 0) {
      throw new Error('No active unverified appointment recovery OTP exists. Start or resend appointment recovery first.');
    }

    const { bookingRecoveryAttemptId, otpHash, expiresAt } = result.rows[0];
    let otp = null;
    for (let value = 0; value <= 999999; value += 1) {
      const candidate = String(value).padStart(6, '0');
      const hash = createHmac('sha256', key)
        .update(`${bookingRecoveryAttemptId}:APPOINTMENT_RECOVERY:${candidate}`, 'utf8')
        .digest('hex');
      if (hash === otpHash) {
        otp = candidate;
        break;
      }
    }

    if (!otp) throw new Error('Unable to recover the active development appointment recovery OTP.');
    console.log('Development appointment recovery OTP ready.');
    console.log(`OTP: ${otp}`);
    console.log(`Expires at: ${new Date(expiresAt).toISOString()}`);
    console.log('Development-only diagnostic. Never use this mechanism in production.');
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
