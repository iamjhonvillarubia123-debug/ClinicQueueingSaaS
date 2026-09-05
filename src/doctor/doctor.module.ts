import { Module } from '@nestjs/common';
import { DoctorAccountDataController } from './doctor-account-data.controller';
import { DoctorAccountDataService } from './doctor-account-data.service';
import { DoctorAuditService } from './doctor-audit.service';
import { DoctorAuditController } from './doctor-audit.controller';
import { AuthModule } from '../auth/auth.module';
import { FinancialModule } from '../financial/financial.module';
import { PrismaModule } from '../prisma/prisma.module';
import { MobileNumberModule } from '../security/mobile-number/mobile-number.module';
import { DoctorController } from './doctor.controller';
import { DoctorDataRetentionService } from './doctor-data-retention.service';
import { DoctorDefaultsApplyService } from './doctor-defaults-apply.service';
import { DoctorDefaultsService } from './doctor-defaults.service';
import { DoctorLifecycleService } from './doctor-lifecycle.service';
import { DoctorProfileOnboardingController } from './doctor-profile-onboarding.controller';
import { DoctorProfileOnboardingService } from './doctor-profile-onboarding.service';
import { DoctorService } from './doctor.service';

@Module({
  imports: [PrismaModule, AuthModule, FinancialModule, MobileNumberModule],
  providers: [
    DoctorAccountDataService,
    DoctorAuditService,
    DoctorService,
    DoctorLifecycleService,
    DoctorDefaultsService,
    DoctorDefaultsApplyService,
    DoctorDataRetentionService,
    DoctorProfileOnboardingService,
  ],
  controllers: [
    DoctorController,
    DoctorAccountDataController,
    DoctorAuditController,
    DoctorProfileOnboardingController,
  ],
  exports: [DoctorDataRetentionService],
})
export class DoctorModule {}
