import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { PracticeLocationLifecycleService } from './practice-location-lifecycle.service';
import { PracticeLocationPermanentDeleteService } from './practice-location-permanent-delete.service';
import { PracticeLocationService } from './practice-location.service';
import { PracticeLocationController } from './practice-location.controller';

@Module({
  imports: [PrismaModule, AuthModule],
  providers: [
    PracticeLocationService,
    PracticeLocationLifecycleService,
    PracticeLocationPermanentDeleteService,
  ],
  controllers: [PracticeLocationController],
})
export class PracticeLocationModule {}
