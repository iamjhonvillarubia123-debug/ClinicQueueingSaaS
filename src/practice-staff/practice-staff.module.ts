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
import { SecretaryWorkspaceController } from './secretary-workspace.controller';
import { SecretaryWorkspaceService } from './secretary-workspace.service';

@Module({
  imports: [PrismaModule, AuthModule],
  providers: [
    PracticeStaffService,
    ClinicSecretaryAuthorityService,
    SubstituteSecretaryCoverageService,
    SecretaryInvitationService,
    SecretaryDirectoryService,
    SecretaryWorkspaceService,
  ],
  controllers: [
    PracticeStaffController,
    SubstituteSecretaryCoverageController,
    SecretaryInvitationController,
    SecretaryDirectoryController,
    SecretaryWorkspaceController,
  ],
  exports: [SubstituteSecretaryCoverageService],
})
export class PracticeStaffModule {}
