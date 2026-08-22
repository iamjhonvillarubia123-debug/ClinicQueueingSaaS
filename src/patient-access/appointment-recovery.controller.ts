import {
  Body,
  Controller,
  Headers,
  Param,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { CsrfOriginGuard } from '../auth/guards/csrf-origin.guard';
import { RateLimit } from '../rate-limit/rate-limit.decorator';
import { AppointmentRecoveryService } from './appointment-recovery.service';
import {
  RequestAppointmentRecoveryDto,
  VerifyAppointmentRecoveryOtpDto,
} from './dto/appointment-recovery.dto';
import {
  PATIENT_BOOKING_ACCESS_COOKIE,
  PatientBookingAccessService,
} from './patient-booking-access.service';

@Controller('patient-bookings/recovery')
export class AppointmentRecoveryController {
  constructor(
    private readonly recovery: AppointmentRecoveryService,
    private readonly patientBookingAccess: PatientBookingAccessService,
  ) {}

  @RateLimit({
    id: 'appointment-recovery-request',
    limit: 5,
    windowMs: 15 * 60 * 1000,
    subject: { kind: 'BODY', field: 'mobileNumber' },
  })
  @UseGuards(CsrfOriginGuard)
  @Post('request')
  request(@Body() dto: RequestAppointmentRecoveryDto) {
    return this.recovery.request(dto);
  }

  @UseGuards(CsrfOriginGuard)
  @Post(':recoveryAttemptId/resend')
  resend(@Param('recoveryAttemptId') recoveryAttemptId: string) {
    return this.recovery.resend(recoveryAttemptId);
  }

  @UseGuards(CsrfOriginGuard)
  @Post('verify')
  verify(@Body() dto: VerifyAppointmentRecoveryOtpDto) {
    return this.recovery.verify(dto);
  }

  @UseGuards(CsrfOriginGuard)
  @Post(':recoveryAttemptId/reject')
  reject(@Param('recoveryAttemptId') recoveryAttemptId: string) {
    return this.recovery.reject(recoveryAttemptId);
  }

  @UseGuards(CsrfOriginGuard)
  @Post(':recoveryAttemptId/confirm')
  async confirm(
    @Param('recoveryAttemptId') recoveryAttemptId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.recovery.confirmAndComplete(
      recoveryAttemptId,
      idempotencyKey,
    );

    if (result.rawToken && result.expiresAt) {
      response.cookie(PATIENT_BOOKING_ACCESS_COOKIE, result.rawToken, {
        httpOnly: true,
        secure: true,
        sameSite: 'strict',
        path: this.patientBookingAccess.cookiePath(
          result.appointment.bookingReference,
        ),
        expires: result.expiresAt,
      });
    }

    return {
      replayed: result.replayed,
      accessRestored: true,
      bookingReference: result.appointment.bookingReference,
      queueNumber: result.appointment.queueNumber,
      credentialTransport: result.rawToken
        ? 'HTTP_ONLY_COOKIE'
        : 'ALREADY_ISSUED',
    };
  }
}
