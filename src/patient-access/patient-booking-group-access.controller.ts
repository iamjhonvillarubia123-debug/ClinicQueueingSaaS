import {
  Body,
  Controller,
  Get,
  Headers,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { CsrfOriginGuard } from '../auth/guards/csrf-origin.guard';
import { RateLimit } from '../rate-limit/rate-limit.decorator';
import { EstablishPatientBookingAccessDto } from './dto/establish-patient-booking-access.dto';
import {
  PATIENT_BOOKING_GROUP_ACCESS_COOKIE,
  PatientBookingGroupAccessService,
} from './patient-booking-group-access.service';

@Controller('patient-booking-groups')
export class PatientBookingGroupAccessController {
  constructor(
    private readonly patientBookingGroupAccess: PatientBookingGroupAccessService,
  ) {}

  @RateLimit({
    id: 'patient-booking-group-access-establish',
    limit: 30,
    windowMs: 5 * 60 * 1000,
    subject: { kind: 'BODY', field: 'token' },
  })
  @UseGuards(CsrfOriginGuard)
  @Post('access')
  async establish(
    @Body() dto: EstablishPatientBookingAccessDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const access = await this.patientBookingGroupAccess.establish(dto.token);
    response.cookie(PATIENT_BOOKING_GROUP_ACCESS_COOKIE, dto.token, {
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      path: this.patientBookingGroupAccess.cookiePath(),
      expires: access.expiresAt,
    });

    return {
      expiresAt: access.expiresAt,
    };
  }

  @Get('dashboard')
  async dashboard(@Headers('cookie') cookieHeader: string | undefined) {
    const rawToken = this.patientBookingGroupAccess.readCookie(cookieHeader);
    const access = await this.patientBookingGroupAccess.establish(rawToken);

    return {
      practiceLocationId: access.bookingGroup.practiceLocationId,
      serviceDate: access.bookingGroup.serviceDate,
      servingProtectionEndedAt: access.bookingGroup.servingProtectionEndedAt,
      visibleMemberCount: access.bookingGroup.members.length,
      members: access.bookingGroup.members,
    };
  }
}
