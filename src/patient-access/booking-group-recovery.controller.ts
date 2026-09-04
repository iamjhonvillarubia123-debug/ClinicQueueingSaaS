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
import { BookingGroupRecoveryService } from './booking-group-recovery.service';
import {
  RequestBookingGroupRecoveryDto,
  VerifyBookingGroupRecoveryOtpDto,
} from './dto/booking-group-recovery.dto';
import { PATIENT_BOOKING_GROUP_ACCESS_COOKIE } from './patient-booking-group-access.service';

@Controller('patient-booking-groups/recovery')
export class BookingGroupRecoveryController {
  constructor(private readonly recovery: BookingGroupRecoveryService) {}

  @RateLimit({
    id: 'booking-group-recovery-request',
    limit: 5,
    windowMs: 15 * 60 * 1000,
    subject: { kind: 'BODY', field: 'mobileNumber' },
  })
  @UseGuards(CsrfOriginGuard)
  @Post('request')
  request(@Body() dto: RequestBookingGroupRecoveryDto) {
    return this.recovery.request(dto);
  }

  @UseGuards(CsrfOriginGuard)
  @Post(':recoveryAttemptId/resend')
  resend(@Param('recoveryAttemptId') recoveryAttemptId: string) {
    return this.recovery.resend(recoveryAttemptId);
  }

  @UseGuards(CsrfOriginGuard)
  @Post('verify')
  verify(@Body() dto: VerifyBookingGroupRecoveryOtpDto) {
    return this.recovery.verify(dto);
  }

  @UseGuards(CsrfOriginGuard)
  @Post(':recoveryAttemptId/complete')
  async complete(
    @Param('recoveryAttemptId') recoveryAttemptId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.recovery.complete(
      recoveryAttemptId,
      idempotencyKey,
    );

    if ('expiresAt' in result && result.rawToken && result.expiresAt) {
      response.cookie(PATIENT_BOOKING_GROUP_ACCESS_COOKIE, result.rawToken, {
        httpOnly: true,
        secure: true,
        sameSite: 'strict',
        path: '/patient-booking-groups',
        expires: result.expiresAt,
      });
    }

    return {
      replayed: result.replayed,
      accessRestored: true,
      credentialTransport: result.rawToken
        ? 'HTTP_ONLY_COOKIE'
        : 'ALREADY_ISSUED',
    };
  }
}
