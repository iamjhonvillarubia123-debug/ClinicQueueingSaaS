import { Controller, Headers, Param, Post, UseGuards } from '@nestjs/common';
import { CsrfOriginGuard } from '../auth/guards/csrf-origin.guard';
import { PatientBookingAccessService } from '../patient-access/patient-booking-access.service';
import { ImHereService } from './im-here.service';

@Controller('patient-bookings')
export class ImHereController {
  constructor(
    private readonly imHereService: ImHereService,
    private readonly patientBookingAccess: PatientBookingAccessService,
  ) {}

  @UseGuards(CsrfOriginGuard)
  @Post(':bookingReference/im-here')
  reinsert(
    @Param('bookingReference') bookingReference: string,
    @Headers('cookie') cookieHeader: string | undefined,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
  ) {
    const rawToken = this.patientBookingAccess.readCookie(cookieHeader);
    return this.imHereService.reinsert(
      bookingReference,
      rawToken,
      idempotencyKey,
    );
  }
}
