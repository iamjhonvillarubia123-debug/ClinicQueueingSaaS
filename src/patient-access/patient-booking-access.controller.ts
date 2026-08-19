import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { CsrfOriginGuard } from '../auth/guards/csrf-origin.guard';
import { ContactPreferenceWithdrawalService } from './contact-preference-withdrawal.service';
import { EstablishPatientBookingAccessDto } from './dto/establish-patient-booking-access.dto';
import { PatientAppointmentDashboardService } from './patient-appointment-dashboard.service';
import {
  PATIENT_BOOKING_ACCESS_COOKIE,
  PatientBookingAccessService,
} from './patient-booking-access.service';

@Controller('patient-bookings')
export class PatientBookingAccessController {
  constructor(
    private readonly patientBookingAccess: PatientBookingAccessService,
    private readonly dashboardService: PatientAppointmentDashboardService,
    private readonly contactPreferenceWithdrawal: ContactPreferenceWithdrawalService,
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

  @Get(':bookingReference/dashboard')
  dashboard(
    @Param('bookingReference') bookingReference: string,
    @Headers('cookie') cookieHeader: string | undefined,
  ) {
    const rawToken = this.patientBookingAccess.readCookie(cookieHeader);
    return this.dashboardService.read(bookingReference, rawToken);
  }

  @UseGuards(CsrfOriginGuard)
  @Patch(':bookingReference/contact-preference/withdraw-reminders')
  withdrawOptionalReminders(
    @Param('bookingReference') bookingReference: string,
    @Headers('cookie') cookieHeader: string | undefined,
  ) {
    const rawToken = this.patientBookingAccess.readCookie(cookieHeader);
    return this.contactPreferenceWithdrawal.withdraw(
      bookingReference,
      rawToken,
    );
  }
}
