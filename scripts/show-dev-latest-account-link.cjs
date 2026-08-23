require('dotenv').config();
const { createDecipheriv, createHmac } = require('crypto');
const { Client } = require('pg');

const KEY_DERIVATION_PURPOSE = 'account-notification-payload-v1';
const TYPES = {
  verification: {
    notificationType: 'DOCTOR_EMAIL_VERIFICATION',
    purpose: 'doctor-email-verification:message',
    label: 'Doctor email verification',
  },
  reset: {
    notificationType: 'PASSWORD_RESET',
    purpose: 'password-reset:message',
    label: 'Password reset',
  },
};

function assertDevelopmentDatabase(databaseUrl) {
  const parsed = new URL(databaseUrl);
  const localHosts = new Set(['localhost', '127.0.0.1', '::1']);
  const databaseName = parsed.pathname.replace(/^\//, '');
  if (process.env.NODE_ENV && process.env.NODE_ENV !== 'development') {
    throw new Error('Refusing to reveal an account link because NODE_ENV is not development.');
  }
  if (!localHosts.has(parsed.hostname)) {
    throw new Error('Refusing to reveal an account link because DATABASE_URL is not local.');
  }
  if (!/(^|_)dev($|_)/i.test(databaseName)) {
    throw new Error('Refusing to reveal an account link because the database name is not development-scoped.');
  }
}

function decrypt(envelope, expectedPurpose) {
  const baseKey = Buffer.from(process.env.MOBILE_ENCRYPTION_KEY_V1, 'base64');
  if (baseKey.length !== 32) throw new Error('MOBILE_ENCRYPTION_KEY_V1 must decode to exactly 32 bytes.');
  const activeKeyId = process.env.MOBILE_ENCRYPTION_ACTIVE_KEY_ID?.trim();
  if (!activeKeyId) throw new Error('MOBILE_ENCRYPTION_ACTIVE_KEY_ID is required.');
  const encryptionKey = createHmac('sha256', baseKey).update(KEY_DERIVATION_PURPOSE, 'utf8').digest();
  const parts = envelope.split('.');
  if (parts.length !== 6) throw new Error('Invalid protected account payload envelope.');
  const [version, keyId, purpose, ivEncoded, tagEncoded, ciphertextEncoded] = parts;
  if (version !== 'v1' || keyId !== activeKeyId || purpose !== expectedPurpose) {
    throw new Error('Protected account payload does not match the expected development diagnostic purpose.');
  }
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey, Buffer.from(ivEncoded, 'base64url'));
  decipher.setAAD(Buffer.from(expectedPurpose, 'utf8'));
  decipher.setAuthTag(Buffer.from(tagEncoded, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextEncoded, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

async function main() {
  const kind = process.argv[2];
  const config = TYPES[kind];
  if (!config) throw new Error('Usage: node scripts/show-dev-latest-account-link.cjs verification|reset');
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL environment variable is not defined.');
  if (!process.env.MOBILE_ENCRYPTION_KEY_V1) throw new Error('MOBILE_ENCRYPTION_KEY_V1 is not defined.');
  assertDevelopmentDatabase(process.env.DATABASE_URL);

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const result = await client.query(`
      SELECT "messageBodyEncrypted", "status"::text AS "status", "createdAt", "expiresAt"
      FROM "NotificationOutbox"
      WHERE "notificationType" = $1::"NotificationType"
        AND "messageBodyEncrypted" IS NOT NULL
      ORDER BY "createdAt" DESC
      LIMIT 1
    `, [config.notificationType]);
    if (result.rowCount === 0) throw new Error(`No ${config.label.toLowerCase()} notification exists in the development database.`);
    const row = result.rows[0];
    const message = decrypt(row.messageBodyEncrypted, config.purpose);
    const match = message.match(/https?:\/\/\S+/);
    console.log(`${config.label} diagnostic`);
    console.log(`Outbox status: ${row.status}`);
    console.log(`Created: ${new Date(row.createdAt).toISOString()}`);
    console.log(`Expires: ${new Date(row.expiresAt).toISOString()}`);
    console.log(match ? `Link: ${match[0]}` : `Message: ${message}`);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
