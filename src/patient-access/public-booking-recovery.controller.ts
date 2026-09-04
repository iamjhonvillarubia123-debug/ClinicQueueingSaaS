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
import {
  RequestAppointmentRecoveryDto,
  VerifyAppointmentRecoveryOtpDto,
} from './dto/appointment-recovery.dto';
import {
  PATIENT_BOOKING_ACCESS_COOKIE,
  PatientBookingAccessService,
} from './patient-booking-access.service';
import { PATIENT_BOOKING_GROUP_ACCESS_COOKIE } from './patient-booking-group-access.service';
import { PublicBookingRecoveryService } from './public-booking-recovery.service';

@Controller('patient-booking-recovery')
export class PublicBookingRecoveryController {
  constructor(
    private readonly recovery: PublicBookingRecoveryService,
    private readonly patientBookingAccess: PatientBookingAccessService,
  ) {}

  @RateLimit({
    id: 'public-booking-recovery-request',
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
  @Post(':recoveryAttemptId/use-existing')
  async useExisting(
    @Param('recoveryAttemptId') recoveryAttemptId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    const completed = await this.recovery.useExisting(
      recoveryAttemptId,
      idempotencyKey,
    );

    if (completed.kind === 'INDIVIDUAL') {
      const result = completed.result;
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
        contextKind: completed.kind,
        replayed: result.replayed,
        accessRestored: true,
        bookingReference: result.appointment.bookingReference,
        queueNumber: result.appointment.queueNumber,
        credentialTransport: result.rawToken
          ? 'HTTP_ONLY_COOKIE'
          : 'ALREADY_ISSUED',
      };
    }

    const result = completed.result;
    if (result.rawToken && result.expiresAt) {
      response.cookie(PATIENT_BOOKING_GROUP_ACCESS_COOKIE, result.rawToken, {
        httpOnly: true,
        secure: true,
        sameSite: 'strict',
        path: '/patient-booking-groups',
        expires: result.expiresAt,
      });
    }
    return {
      contextKind: completed.kind,
      replayed: result.replayed,
      accessRestored: true,
      bookingGroupId: result.bookingGroupId,
      credentialTransport: result.rawToken
        ? 'HTTP_ONLY_COOKIE'
        : 'ALREADY_ISSUED',
    };
  }

  @RateLimit({
    id: 'public-booking-recovery-replace-existing',
    limit: 10,
    windowMs: 15 * 60 * 1000,
    subject: { kind: 'PARAM', field: 'recoveryAttemptId' },
  })
  @UseGuards(CsrfOriginGuard)
  @Post(':recoveryAttemptId/replace-existing')
  replaceExisting(@Param('recoveryAttemptId') recoveryAttemptId: string) {
    return this.recovery.authorizeReplacement(recoveryAttemptId);
  }
}
