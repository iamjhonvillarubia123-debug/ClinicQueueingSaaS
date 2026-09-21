import {
  Body,
  Controller,
  Headers,
  Param,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { IsBoolean, IsDateString, IsOptional } from 'class-validator';
import { CsrfOriginGuard } from '../auth/guards/csrf-origin.guard';
import { SessionAuthGuard } from '../auth/guards/session-auth.guard';
import type { AuthenticatedRequest } from '../auth/types/authenticated-request';
import { PatientBookingAccessService } from '../patient-access/patient-booking-access.service';
import { ReservationManagementService } from './reservation-management.service';
import { PatientBookingGroupAccessService } from '../patient-access/patient-booking-group-access.service';

export class RescheduleReservationDto {
  @IsDateString({ strict: true })
  reservationAt!: string;
  @IsOptional()
  @IsBoolean()
  confirmAvailabilityOverride?: boolean;
}

@Controller()
export class ReservationManagementController {
  constructor(
    private readonly management: ReservationManagementService,
    private readonly access: PatientBookingAccessService,
    private readonly groupAccess: PatientBookingGroupAccessService,
  ) {}

  @UseGuards(SessionAuthGuard, CsrfOriginGuard)
  @Post('appointments/:appointmentId/reschedule')
  staffReschedule(
    @Param('appointmentId') id: string,
    @Body() dto: RescheduleReservationDto,
    @Headers('idempotency-key') key: string,
    @Request() request: AuthenticatedRequest,
  ) {
    return this.management.execute(
      { userId: request.user.userId },
      id,
      'RESCHEDULE',
      key,
      dto.reservationAt,
      dto.confirmAvailabilityOverride,
    );
  }
  @UseGuards(SessionAuthGuard, CsrfOriginGuard)
  @Post('appointments/:appointmentId/start-service')
  start(
    @Param('appointmentId') id: string,
    @Headers('idempotency-key') key: string,
    @Request() request: AuthenticatedRequest,
  ) {
    return this.management.execute(
      { userId: request.user.userId },
      id,
      'START_SERVICE',
      key,
    );
  }
  @UseGuards(CsrfOriginGuard)
  @Post('patient-bookings/:bookingReference/reschedule')
  reschedule(
    @Param('bookingReference') bookingReference: string,
    @Body() dto: RescheduleReservationDto,
    @Headers('idempotency-key') key: string,
    @Headers('cookie') cookie: string | undefined,
  ) {
    return this.management.execute(
      { bookingReference, token: this.access.readCookie(cookie) },
      bookingReference,
      'RESCHEDULE',
      key,
      dto.reservationAt,
    );
  }
  @UseGuards(CsrfOriginGuard)
  @Post('patient-bookings/:bookingReference/cancel')
  cancel(
    @Param('bookingReference') bookingReference: string,
    @Headers('idempotency-key') key: string,
    @Headers('cookie') cookie: string | undefined,
  ) {
    return this.management.execute(
      { bookingReference, token: this.access.readCookie(cookie) },
      bookingReference,
      'CANCEL',
      key,
    );
  }
  @UseGuards(CsrfOriginGuard)
  @Post(
    'patient-booking-groups/:bookingGroupId/members/:bookingReference/reschedule',
  )
  rescheduleMember(
    @Param('bookingGroupId') bookingGroupId: string,
    @Param('bookingReference') bookingReference: string,
    @Body() dto: RescheduleReservationDto,
    @Headers('idempotency-key') key: string,
    @Headers('cookie') cookie: string | undefined,
  ) {
    return this.management.execute(
      {
        bookingGroupId,
        bookingReference,
        token: this.groupAccess.readCookie(cookie),
      },
      bookingReference,
      'RESCHEDULE',
      key,
      dto.reservationAt,
    );
  }
}
