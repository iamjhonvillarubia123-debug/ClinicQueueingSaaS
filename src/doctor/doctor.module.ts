import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { MobileNumberModule } from '../security/mobile-number/mobile-number.module';
import { DoctorController } from './doctor.controller';
import { DoctorDefaultsService } from './doctor-defaults.service';
import { DoctorLifecycleService } from './doctor-lifecycle.service';
import { DoctorService } from './doctor.service';

@Module({
  imports: [PrismaModule, AuthModule, MobileNumberModule],
  providers: [DoctorService, DoctorLifecycleService, DoctorDefaultsService],
  controllers: [DoctorController],
})
export class DoctorModule {}
