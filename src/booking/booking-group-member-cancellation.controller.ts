import {
  Body,
  Controller,
  Headers,
  Param,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { BookingGroupMemberCancellationService } from './booking-group-member-cancellation.service';
import { CancelBookingGroupMemberDto } from './dto/cancel-booking-group-member.dto';

@Controller('booking/groups')
export class BookingGroupMemberCancellationController {
  constructor(
    private readonly cancellation: BookingGroupMemberCancellationService,
  ) {}

  @Post(':bookingGroupId/members/:appointmentId/cancel')
  cancelMember(
    @Param('bookingGroupId') bookingGroupId: string,
    @Param('appointmentId') appointmentId: string,
    @Headers('authorization') authorization: string | undefined,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() dto: CancelBookingGroupMemberDto,
  ) {
    const rawToken = this.readBearerToken(authorization);
    if (!idempotencyKey?.trim()) {
      throw new UnauthorizedException('Idempotency-Key is required.');
    }
    return this.cancellation.cancel(
      bookingGroupId,
      appointmentId,
      rawToken,
      dto,
      idempotencyKey,
    );
  }

  private readBearerToken(authorization: string | undefined): string {
    if (!authorization?.startsWith('Bearer ')) {
      throw new UnauthorizedException(
        'BookingGroup controller access token is required.',
      );
    }
    const rawToken = authorization.slice('Bearer '.length).trim();
    if (!rawToken) {
      throw new UnauthorizedException(
        'BookingGroup controller access token is required.',
      );
    }
    return rawToken;
  }
}
