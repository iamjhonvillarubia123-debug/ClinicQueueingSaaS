import 'dotenv/config';
import { randomBytes } from 'crypto';
import * as bcrypt from 'bcrypt';
import { PrismaPg } from '@prisma/adapter-pg';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const prismaModule = require('../generated/prisma/client.js') as typeof import('../generated/prisma/client');

const {
  AdministrativeRestrictionStatus,
  PrismaClient,
  UserAccountStatus,
  UserRole,
} = prismaModule;

const ACCEPTANCE_EMAIL = 'frontend.acceptance.doctor@local.test';
const ACCEPTANCE_MOBILE = '+639000000000';
const BCRYPT_SALT_ROUNDS = 12;

async function main(): Promise<void> {
  if (process.env.NODE_ENV !== 'development') {
    throw new Error(
      'Refusing to create the acceptance user because NODE_ENV is not development.',
    );
  }

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL environment variable is not defined.');
  }

  const adapter = new PrismaPg({ connectionString });
  const prisma = new PrismaClient({ adapter });
  const temporaryPassword = `F0-${randomBytes(18).toString('base64url')}`;
  const passwordHash = await bcrypt.hash(temporaryPassword, BCRYPT_SALT_ROUNDS);
  const now = new Date();

  try {
    const existing = await prisma.user.findFirst({
      where: { email: ACCEPTANCE_EMAIL },
      select: { id: true },
    });

    const user = existing
      ? await prisma.user.update({
          where: { id: existing.id },
          data: {
            firstName: 'Frontend',
            middleName: null,
            lastName: 'Acceptance',
            mobileNumber: ACCEPTANCE_MOBILE,
            passwordHash,
            role: UserRole.DOCTOR,
            accountStatus: UserAccountStatus.ACTIVE,
            administrativeRestrictionStatus:
              AdministrativeRestrictionStatus.NONE,
            emailVerifiedAt: now,
          },
          select: { id: true, email: true, role: true },
        })
      : await prisma.user.create({
          data: {
            email: ACCEPTANCE_EMAIL,
            firstName: 'Frontend',
            middleName: null,
            lastName: 'Acceptance',
            mobileNumber: ACCEPTANCE_MOBILE,
            passwordHash,
            role: UserRole.DOCTOR,
            accountStatus: UserAccountStatus.ACTIVE,
            administrativeRestrictionStatus:
              AdministrativeRestrictionStatus.NONE,
            emailVerifiedAt: now,
          },
          select: { id: true, email: true, role: true },
        });

    await prisma.userSession.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: now },
    });

    console.log('Development acceptance user ready.');
    console.log(`Email: ${user.email}`);
    console.log(`Temporary password: ${temporaryPassword}`);
    console.log(`Role: ${user.role}`);
    console.log('This password is generated locally and is not stored in the repository.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
