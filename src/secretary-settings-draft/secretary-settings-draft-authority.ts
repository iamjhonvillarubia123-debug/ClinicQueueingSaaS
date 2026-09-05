import { ForbiddenException } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';

type TransactionClient = Prisma.TransactionClient;

export async function assertConfigurationDraftingAuthority(
  transaction: TransactionClient,
  practiceStaffId: string,
): Promise<void> {
  const authority = await transaction.practiceStaffAuthorityBundle.findFirst({
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
