import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { DoctorService } from './doctor.service';
import { DoctorController } from './doctor.controller';

@Module({
  imports: [PrismaModule],
  providers: [DoctorService],
  controllers: [DoctorController],
})
export class DoctorModule {}