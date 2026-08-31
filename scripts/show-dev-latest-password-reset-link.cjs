const { Client } = require('pg');
const {
  assertDevelopmentDatabase,
  buildEncryptionContract,
  decrypt,
} = require('./show-dev-latest-email-verification-link.cjs');

const PASSWORD_RESET_PAYLOAD_PURPOSE = 'password-reset';

function extractPasswordResetUrl(message) {
  const match = message.match(/https?:\/\/[^\s<>"']+\/reset-password\?[^\s<>"']+/u);
  if (!match) {
    throw new Error(
      'The decrypted notification does not contain a password-reset URL.',
    );
  }
  return match[0];
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

  const contract = buildEncryptionContract();
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    const result = await client.query(`
      SELECT
        reset."expiresAt",
        account."role"::text AS "role",
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
    const recipient = decrypt(
      row.recipientEmailEncrypted,
      `${PASSWORD_RESET_PAYLOAD_PURPOSE}:recipient`,
      contract,
    );
    const message = decrypt(
      row.messageBodyEncrypted,
      `${PASSWORD_RESET_PAYLOAD_PURPOSE}:message`,
      contract,
    );
    const resetUrl = extractPasswordResetUrl(message);

    console.log('');
    console.log(`Role: ${row.role}`);
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

module.exports = { extractPasswordResetUrl };
