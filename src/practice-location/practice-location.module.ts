import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { PracticeLocationService } from './practice-location.service';
import { PracticeLocationController } from './practice-location.controller';

@Module({
  imports: [PrismaModule, AuthModule],
  providers: [PracticeLocationService],
  controllers: [PracticeLocationController],
})
export class PracticeLocationModule {}
