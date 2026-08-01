import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './auth/auth.module';
import { PrismaModule } from './prisma/prisma.module';
import { AppController } from './app/app.controller';
import { DoctorModule } from './doctor/doctor.module';
import { PracticeLocationModule } from './practice-location/practice-location.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    AuthModule,
    PrismaModule,
    DoctorModule,
    PracticeLocationModule,
  ],
  controllers: [AppController],
})
export class AppModule {}