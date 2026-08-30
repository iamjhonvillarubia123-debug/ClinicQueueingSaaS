import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';

import { ClinicSecretaryAuthorityService } from './clinic-secretary-authority.service';
import { PracticeStaffService } from './practice-staff.service';
import { PracticeStaffController } from './practice-staff.controller';
import { SubstituteSecretaryCoverageController } from './substitute-secretary-coverage.controller';
import { SubstituteSecretaryCoverageService } from './substitute-secretary-coverage.service';
import { SecretaryInvitationController } from './secretary-invitation.controller';
import { SecretaryInvitationService } from './secretary-invitation.service';
import { SecretaryDirectoryController } from './secretary-directory.controller';
import { SecretaryDirectoryService } from './secretary-directory.service';

@Module({
  imports: [PrismaModule, AuthModule],
  providers: [
    PracticeStaffService,
    ClinicSecretaryAuthorityService,
    SubstituteSecretaryCoverageService,
    SecretaryInvitationService,
    SecretaryDirectoryService,
  ],
  controllers: [
    PracticeStaffController,
    SubstituteSecretaryCoverageController,
    SecretaryInvitationController,
    SecretaryDirectoryController,
  ],
  exports: [SubstituteSecretaryCoverageService],
})
export class PracticeStaffModule {}
