import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { CsrfOriginGuard } from '../auth/guards/csrf-origin.guard';
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
      path: this.patientBookingGroupAccess.cookiePath(access.bookingGroup.id),
      expires: access.expiresAt,
    });

    return {
      bookingGroupId: access.bookingGroup.id,
      expiresAt: access.expiresAt,
    };
  }

  @Get(':bookingGroupId')
  async view(
    @Param('bookingGroupId') bookingGroupId: string,
    @Headers('cookie') cookieHeader: string | undefined,
  ) {
    const rawToken = this.patientBookingGroupAccess.readCookie(cookieHeader);
    const access = await this.patientBookingGroupAccess.establish(rawToken);

    if (access.bookingGroup.id !== bookingGroupId) {
      return this.patientBookingGroupAccess.reject();
    }

    return {
      bookingGroup: access.bookingGroup,
    };
  }
}
