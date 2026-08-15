import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './auth/auth.module';
import { PrismaModule } from './prisma/prisma.module';
import { AppController } from './app/app.controller';
import { DoctorModule } from './doctor/doctor.module';
import { PracticeLocationModule } from './practice-location/practice-location.module';
import { PracticeStaffModule } from './practice-staff/practice-staff.module';
import { PatientModule } from './patient/patient.module';
import { BookingModule } from './booking/booking.module';
import { SecretaryModule } from './secretary/secretary.module';
import { SystemAdminModule } from './system-admin/system-admin.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    AuthModule,
    PrismaModule,
    DoctorModule,
    SecretaryModule,
    SystemAdminModule,
    PracticeLocationModule,
    PracticeStaffModule,
    PatientModule,
    BookingModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
