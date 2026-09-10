const { createHmac } = require('crypto');
const { PrismaClient } = require('../generated/prisma');

function normalizePhilippineMobile(input) {
  const compact = String(input || '').trim().replace(/[\s()-]/g, '');
  if (/^\+639\d{9}$/.test(compact)) return compact;
  if (/^639\d{9}$/.test(compact)) return `+${compact}`;
  if (/^09\d{9}$/.test(compact)) return `+63${compact.slice(1)}`;
  if (/^9\d{9}$/.test(compact)) return `+63${compact}`;
  throw new Error('Enter a Philippine mobile number such as +639171234567 or 09171234567.');
}

async function main() {
  const raw = process.argv[2];
  if (!raw) {
    throw new Error('Usage: node scripts/r3-diagnose-account-by-mobile.cjs <mobile-number>');
  }

  const canonical = normalizePhilippineMobile(raw);
  const keyBase64 = process.env.MOBILE_LOOKUP_HMAC_KEY_V1;
  if (!keyBase64) {
    throw new Error('MOBILE_LOOKUP_HMAC_KEY_V1 is not available in the current environment.');
  }
  const key = Buffer.from(keyBase64, 'base64');
  if (key.length !== 32) {
    throw new Error('MOBILE_LOOKUP_HMAC_KEY_V1 must decode to exactly 32 bytes.');
  }

  const hash = createHmac('sha256', key).update(canonical, 'utf8').digest('hex');
  const prisma = new PrismaClient();
  try {
    const users = await prisma.user.findMany({
      where: { mobileNumberHash: hash },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        role: true,
        accountStatus: true,
        administrativeRestrictionStatus: true,
        loginIdentifierType: true,
        mobileVerifiedAt: true,
        emailVerifiedAt: true,
        createdAt: true,
      },
    });

    console.log(`Mobile: ${canonical}`);
    console.log(`Matching account rows: ${users.length}`);
    if (users.length === 0) {
      console.log('No account row matches this mobile number.');
      return;
    }

    for (const [index, user] of users.entries()) {
      const primaryVerified = user.loginIdentifierType === 'MOBILE'
        ? Boolean(user.mobileVerifiedAt)
        : Boolean(user.emailVerifiedAt);
      const ordinaryAuthEligible =
        user.accountStatus === 'ACTIVE' &&
        user.administrativeRestrictionStatus === 'NONE' &&
        primaryVerified;

      console.log(`\nAccount ${index + 1}`);
      console.log(`  userId: ${user.id}`);
      console.log(`  role: ${user.role}`);
      console.log(`  accountStatus: ${user.accountStatus}`);
      console.log(`  administrativeRestrictionStatus: ${user.administrativeRestrictionStatus}`);
      console.log(`  loginIdentifierType: ${user.loginIdentifierType}`);
      console.log(`  primaryIdentifierVerified: ${primaryVerified ? 'YES' : 'NO'}`);
      console.log(`  ordinaryAuthenticationEligible: ${ordinaryAuthEligible ? 'YES' : 'NO'}`);
      console.log(`  createdAt: ${user.createdAt.toISOString()}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
