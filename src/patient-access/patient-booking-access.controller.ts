import { Body, Controller, Post, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { CsrfOriginGuard } from '../auth/guards/csrf-origin.guard';
import { EstablishPatientBookingAccessDto } from './dto/establish-patient-booking-access.dto';
import {
  PATIENT_BOOKING_ACCESS_COOKIE,
  PatientBookingAccessService,
} from './patient-booking-access.service';

@Controller('patient-bookings')
export class PatientBookingAccessController {
  constructor(
    private readonly patientBookingAccess: PatientBookingAccessService,
  ) {}

  @UseGuards(CsrfOriginGuard)
  @Post('access')
  async establish(
    @Body() dto: EstablishPatientBookingAccessDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const access = await this.patientBookingAccess.establish(dto.token);
    response.cookie(PATIENT_BOOKING_ACCESS_COOKIE, dto.token, {
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      path: this.patientBookingAccess.cookiePath(
        access.appointment.bookingReference,
      ),
      expires: access.expiresAt,
    });

    return {
      bookingReference: access.appointment.bookingReference,
      expiresAt: access.expiresAt,
    };
  }
}
