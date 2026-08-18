import {
  Body,
  Controller,
  Headers,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { CsrfOriginGuard } from '../auth/guards/csrf-origin.guard';
import { PatientBookingGroupAccessService } from '../patient-access/patient-booking-group-access.service';
import { BookingGroupAddPersonService } from './booking-group-add-person.service';
import { AddBookingGroupPersonDto } from './dto/add-booking-group-person.dto';

@Controller('patient-booking-groups')
export class BookingGroupAddPersonController {
  constructor(
    private readonly addPersonService: BookingGroupAddPersonService,
    private readonly groupAccess: PatientBookingGroupAccessService,
  ) {}

  @UseGuards(CsrfOriginGuard)
  @Post(':bookingGroupId/members')
  addPerson(
    @Param('bookingGroupId') bookingGroupId: string,
    @Req() request: Request,
    @Body() dto: AddBookingGroupPersonDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
  ) {
    const rawToken = this.groupAccess.readCookie(request.headers.cookie);
    return this.addPersonService.addPerson(
      bookingGroupId,
      rawToken,
      dto,
      idempotencyKey,
    );
  }
}
