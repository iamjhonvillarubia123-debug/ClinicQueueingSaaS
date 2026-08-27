import {
  MiddlewareConsumer,
  Module,
  NestModule,
  RequestMethod,
} from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { AppController } from './app/app.controller';
import { AuthModule } from './auth/auth.module';
import { CsrfOriginGuard } from './auth/guards/csrf-origin.guard';
import { BookingModule } from './booking/booking.module';
import { validateRuntimeConfig } from './config/production-config';
import { DoctorModule } from './doctor/doctor.module';
import { FinancialModule } from './financial/financial.module';
import { NotificationModule } from './notification/notification.module';
import { PatientModule } from './patient/patient.module';
import { PracticeLocationModule } from './practice-location/practice-location.module';
import { PracticeStaffModule } from './practice-staff/practice-staff.module';
import { PrismaModule } from './prisma/prisma.module';
import { PrivacyRetentionModule } from './privacy-retention/privacy-retention.module';
import { PublicRoutingModule } from './public-routing/public-routing.module';
import { QueueModule } from './queue/queue.module';
import { RateLimitGuard } from './rate-limit/rate-limit.guard';
import { RateLimitModule } from './rate-limit/rate-limit.module';
import { OperationalLoggingMiddleware } from './request-context/operational-logging.middleware';
import { RequestCorrelationMiddleware } from './request-context/request-correlation.middleware';
import { RequestIdExceptionFilter } from './request-context/request-id-exception.filter';
import { ScheduleModule } from './schedule/schedule.module';
import { SecretaryModule } from './secretary/secretary.module';
import { SecretarySettingsDraftModule } from './secretary-settings-draft/secretary-settings-draft.module';
import { SystemAdminModule } from './system-admin/system-admin.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateRuntimeConfig,
    }),
    AuthModule,
    PrismaModule,
    RateLimitModule,
    NotificationModule,
    FinancialModule,
    DoctorModule,
    SecretaryModule,
    SecretarySettingsDraftModule,
    SystemAdminModule,
    PracticeLocationModule,
    PracticeStaffModule,
    QueueModule,
    ScheduleModule,
    PatientModule,
    BookingModule,
    PrivacyRetentionModule,
    PublicRoutingModule,
  ],
  controllers: [AppController],
  providers: [
    {
      provide: APP_GUARD,
      useClass: CsrfOriginGuard,
    },
    {
      provide: APP_GUARD,
      useClass: RateLimitGuard,
    },
    {
      provide: APP_FILTER,
      useClass: RequestIdExceptionFilter,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(RequestCorrelationMiddleware, OperationalLoggingMiddleware)
      .forRoutes({
        path: '{*splat}',
        method: RequestMethod.ALL,
      });
  }
}
