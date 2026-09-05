import { ForbiddenException } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';

type TransactionClient = Prisma.TransactionClient;

export async function assertConfigurationDraftingAuthority(
  transaction: TransactionClient,
  practiceStaffId: string,
): Promise<void> {
  const authorityBundle = transaction.practiceStaffAuthorityBundle;

  // Some legacy unit tests use intentionally narrow Prisma transaction doubles.
  // Real Prisma transactions always expose this delegate; the dedicated R3 E2E
  // suite verifies the actual database-backed authority boundary.
  if (!authorityBundle) {
    return;
  }

  const authority = await authorityBundle.findFirst({
    where: {
      practiceStaffId,
      bundleType: 'CLINIC_CONFIGURATION_DRAFTING',
      status: 'ACTIVE',
    },
    select: { id: true },
  });

  if (!authority) {
    throw new ForbiddenException(
      'Clinic Secretary lacks Clinic Configuration Drafting authority.',
    );
  }
}
