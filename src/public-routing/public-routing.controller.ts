import { Controller, Get, Param } from '@nestjs/common';
import { PublicQueueService } from './public-queue.service';
import { PublicRoutingService } from './public-routing.service';

@Controller('public')
export class PublicRoutingController {
  constructor(
    private readonly publicRouting: PublicRoutingService,
    private readonly publicQueue: PublicQueueService,
  ) {}

  @Get('doctors/:publicIdentifier')
  getDoctor(@Param('publicIdentifier') publicIdentifier: string) {
    return this.publicRouting.getDoctorPublicRoute(publicIdentifier);
  }

  @Get('practice-locations/:publicIdentifier')
  getPracticeLocation(@Param('publicIdentifier') publicIdentifier: string) {
    return this.publicRouting.getPracticeLocationPublicRoute(publicIdentifier);
  }

  @Get('practice-locations/:publicIdentifier/queue/:serviceDate')
  getPublicQueue(
    @Param('publicIdentifier') publicIdentifier: string,
    @Param('serviceDate') serviceDate: string,
  ) {
    return this.publicQueue.getPublicQueue(publicIdentifier, serviceDate);
  }
}
