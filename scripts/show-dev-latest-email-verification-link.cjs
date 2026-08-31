require('dotenv').config();
const { createDecipheriv, createHmac } = require('crypto');
const { Client } = require('pg');

const KEY_DERIVATION_PURPOSE = 'account-notification-payload-v1';
const EMAIL_PAYLOAD_PURPOSE = 'doctor-email-verification';

function assertDevelopmentDatabase(databaseUrl) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'Refusing to reveal an email verification link because NODE_ENV is production.',
    );
  }

  const parsed = new URL(databaseUrl);
  const localHosts = new Set(['localhost', '127.0.0.1', '::1']);
  const databaseName = parsed.pathname.replace(/^\//, '');

  if (!localHosts.has(parsed.hostname)) {
    throw new Error(
      'Refusing to reveal an email verification link because DATABASE_URL is not local.',
    );
  }
  if (!/(^|_)dev($|_)/i.test(databaseName)) {
    throw new Error(
      'Refusing to reveal an email verification link because the database name is not development-scoped.',
    );
  }
}

function buildEncryptionContract() {
  const keyBase64 = process.env.MOBILE_ENCRYPTION_KEY_V1;
  const activeKeyId = process.env.MOBILE_ENCRYPTION_ACTIVE_KEY_ID;
  if (!keyBase64) {
    throw new Error('MOBILE_ENCRYPTION_KEY_V1 is not defined.');
  }
  if (!activeKeyId || !activeKeyId.trim()) {
    throw new Error('MOBILE_ENCRYPTION_ACTIVE_KEY_ID is not defined.');
  }

  const baseKey = Buffer.from(keyBase64, 'base64');
  if (baseKey.length !== 32) {
    throw new Error(
      'MOBILE_ENCRYPTION_KEY_V1 must decode to exactly 32 bytes.',
    );
  }

  return {
    activeKeyId: activeKeyId.trim(),
    encryptionKey: createHmac('sha256', baseKey)
      .update(KEY_DERIVATION_PURPOSE, 'utf8')
      .digest(),
  };
}

function decrypt(envelope, expectedPurpose, contract) {
  if (typeof envelope !== 'string') {
    throw new Error('The verification notification payload is missing.');
  }
  const parts = envelope.split('.');
  if (parts.length !== 6) {
    throw new Error('Invalid protected account payload envelope.');
  }

  const [version, keyId, purpose, iv, tag, ciphertext] = parts;
  if (
    version !== 'v1' ||
    keyId !== contract.activeKeyId ||
    purpose !== expectedPurpose
  ) {
    throw new Error('Invalid protected account payload envelope.');
  }

  try {
    const decipher = createDecipheriv(
      'aes-256-gcm',
      contract.encryptionKey,
      Buffer.from(iv, 'base64url'),
    );
    decipher.setAAD(Buffer.from(expectedPurpose, 'utf8'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertext, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    throw new Error('Unable to decrypt the email verification payload.');
  }
}

function extractVerificationUrl(message) {
  const match = message.match(/https?:\/\/[^\s<>"']+/u);
  if (!match) {
    throw new Error(
      'The decrypted notification does not contain a verification URL.',
    );
  }
  return match[0];
}

async function main() {
  console.log('Clinic Queueing development email-verification helper');
  console.log('Read-only: this command does not verify or modify an account.');

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL environment variable is not defined.');
  }
  assertDevelopmentDatabase(databaseUrl);
  const contract = buildEncryptionContract();
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    const result = await client.query(`
      SELECT
        verification."expiresAt",
        account."role"::text AS "role",
        outbox."recipientEmailEncrypted",
        outbox."messageBodyEncrypted"
      FROM "EmailVerification" verification
      INNER JOIN "User" account ON account."id" = verification."userId"
      LEFT JOIN "NotificationOutbox" outbox
        ON outbox."emailVerificationId" = verification."id"
      WHERE verification."status" = 'PENDING'::"EmailVerificationStatus"
        AND verification."activeVerificationKey" IS NOT NULL
        AND verification."tokenHash" IS NOT NULL
        AND account."role" IN ('DOCTOR'::"UserRole", 'SECRETARY'::"UserRole")
      ORDER BY verification."createdAt" DESC
      LIMIT 1
    `);

    if (result.rowCount === 0) {
      throw new Error(
        'No pending Doctor or Secretary email verification exists in the development database.',
      );
    }

    const row = result.rows[0];
    const recipient = decrypt(
      row.recipientEmailEncrypted,
      `${EMAIL_PAYLOAD_PURPOSE}:recipient`,
      contract,
    );
    const message = decrypt(
      row.messageBodyEncrypted,
      `${EMAIL_PAYLOAD_PURPOSE}:message`,
      contract,
    );
    const verificationUrl = extractVerificationUrl(message);

    console.log('');
    console.log(`Role: ${row.role}`);
    console.log(`Recipient: ${recipient}`);
    console.log(`Expires at: ${new Date(row.expiresAt).toISOString()}`);
    console.log('');
    console.log('Verification URL:');
    console.log(verificationUrl);
    console.log('');
    console.log(
      'Open this URL manually to exercise the normal verification endpoint.',
    );
  } finally {
    await client.end();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`Development helper failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  assertDevelopmentDatabase,
  buildEncryptionContract,
  decrypt,
  extractVerificationUrl,
};
