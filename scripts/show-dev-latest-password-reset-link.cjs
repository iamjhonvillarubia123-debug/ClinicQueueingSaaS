const { createDecipheriv, createHmac } = require('crypto');
const { Client } = require('pg');
const {
  assertDevelopmentDatabase,
  buildEncryptionContract,
  decrypt,
} = require('./show-dev-latest-email-verification-link.cjs');

const PASSWORD_RESET_PAYLOAD_PURPOSE = 'password-reset';
const NOTIFICATION_MESSAGE_KEY_PURPOSE = 'notification-outbox-message-v1';
const NOTIFICATION_MESSAGE_PURPOSE = 'notification-outbox:message';

function extractPasswordResetUrl(message) {
  const match = message.match(/https?:\/\/[^\s<>"']+\/reset-password\?[^\s<>"']+/u);
  if (!match) {
    throw new Error(
      'The decrypted notification does not contain a password-reset URL.',
    );
  }
  return match[0];
}

function decryptNotificationMessage(envelope) {
  if (typeof envelope !== 'string') {
    throw new Error('The protected password-reset message is missing.');
  }

  const keyBase64 = process.env.MOBILE_ENCRYPTION_KEY_V1;
  const activeKeyId = process.env.MOBILE_ENCRYPTION_ACTIVE_KEY_ID;
  if (!keyBase64) throw new Error('MOBILE_ENCRYPTION_KEY_V1 is not defined.');
  if (!activeKeyId || !activeKeyId.trim()) {
    throw new Error('MOBILE_ENCRYPTION_ACTIVE_KEY_ID is not defined.');
  }

  const baseKey = Buffer.from(keyBase64, 'base64');
  if (baseKey.length !== 32) {
    throw new Error('MOBILE_ENCRYPTION_KEY_V1 must decode to exactly 32 bytes.');
  }

  const parts = envelope.split('.');
  if (parts.length !== 6) {
    throw new Error('Invalid protected notification message envelope.');
  }

  const [version, keyId, purpose, iv, tag, ciphertext] = parts;
  if (
    version !== 'v1' ||
    keyId !== activeKeyId.trim() ||
    purpose !== NOTIFICATION_MESSAGE_PURPOSE
  ) {
    throw new Error('Invalid protected notification message envelope.');
  }

  const encryptionKey = createHmac('sha256', baseKey)
    .update(NOTIFICATION_MESSAGE_KEY_PURPOSE, 'utf8')
    .digest();

  try {
    const decipher = createDecipheriv(
      'aes-256-gcm',
      encryptionKey,
      Buffer.from(iv, 'base64url'),
    );
    decipher.setAAD(Buffer.from(NOTIFICATION_MESSAGE_PURPOSE, 'utf8'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertext, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    throw new Error('Unable to decrypt the protected password-reset message.');
  }
}

async function main() {
  console.log('Clinic Queueing development password-reset helper');
  console.log(
    'Read-only: this command does not reset a password, consume a token, or modify an account.',
  );

  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'Refusing to reveal a password-reset link because NODE_ENV is production.',
    );
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL environment variable is not defined.');
  }
  assertDevelopmentDatabase(databaseUrl);

  const protectedAccountContract = buildEncryptionContract();
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    const result = await client.query(`
      SELECT
        reset."expiresAt",
        account."role"::text AS "role",
        account."loginIdentifierType"::text AS "loginIdentifierType",
        outbox."channel"::text AS "channel",
        outbox."recipientEmailEncrypted",
        outbox."messageBodyEncrypted"
      FROM "PasswordReset" reset
      INNER JOIN "User" account ON account."id" = reset."userId"
      LEFT JOIN "NotificationOutbox" outbox
        ON outbox."passwordResetId" = reset."id"
      WHERE reset."status" = 'PENDING'::"PasswordResetStatus"
        AND reset."activeResetKey" IS NOT NULL
        AND reset."tokenHash" IS NOT NULL
        AND reset."expiresAt" > NOW()
        AND account."role" IN ('DOCTOR'::"UserRole", 'SECRETARY'::"UserRole")
      ORDER BY reset."createdAt" DESC
      LIMIT 1
    `);

    if (result.rowCount === 0) {
      throw new Error(
        'No unexpired pending Doctor or Secretary password reset exists in the development database. Request a reset from the Forgot password page first.',
      );
    }

    const row = result.rows[0];
    if (!row.channel || !row.messageBodyEncrypted) {
      throw new Error(
        'The latest password reset exists but its notification outbox payload is missing.',
      );
    }

    const isEmail = row.channel === 'EMAIL';
    const recipient = isEmail
      ? decrypt(
          row.recipientEmailEncrypted,
          `${PASSWORD_RESET_PAYLOAD_PURPOSE}:recipient`,
          protectedAccountContract,
        )
      : 'mobile-primary account';
    const message = isEmail
      ? decrypt(
          row.messageBodyEncrypted,
          `${PASSWORD_RESET_PAYLOAD_PURPOSE}:message`,
          protectedAccountContract,
        )
      : decryptNotificationMessage(row.messageBodyEncrypted);
    const resetUrl = extractPasswordResetUrl(message);

    console.log('');
    console.log(`Role: ${row.role}`);
    console.log(`Primary identifier: ${row.loginIdentifierType}`);
    console.log(`Delivery channel: ${row.channel}`);
    console.log(`Recipient: ${recipient}`);
    console.log(`Expires at: ${new Date(row.expiresAt).toISOString()}`);
    console.log('');
    console.log('Password-reset URL:');
    console.log(resetUrl);
    console.log('');
    console.log(
      'Open this URL manually to exercise the normal one-time password-reset flow.',
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

module.exports = { extractPasswordResetUrl, decryptNotificationMessage };
