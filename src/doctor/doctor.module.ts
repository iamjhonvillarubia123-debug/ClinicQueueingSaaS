import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { FinancialModule } from '../financial/financial.module';
import { PrismaModule } from '../prisma/prisma.module';
import { MobileNumberModule } from '../security/mobile-number/mobile-number.module';
import { DoctorController } from './doctor.controller';
import { DoctorDefaultsApplyService } from './doctor-defaults-apply.service';
import { DoctorDefaultsService } from './doctor-defaults.service';
import { DoctorLifecycleService } from './doctor-lifecycle.service';
import { DoctorService } from './doctor.service';

@Module({
  imports: [PrismaModule, AuthModule, FinancialModule, MobileNumberModule],
  providers: [
    DoctorService,
    DoctorLifecycleService,
    DoctorDefaultsService,
    DoctorDefaultsApplyService,
  ],
  controllers: [DoctorController],
})
export class DoctorModule {}
