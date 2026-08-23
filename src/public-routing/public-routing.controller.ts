import { Controller, Get, Param } from '@nestjs/common';
import { RateLimit } from '../rate-limit/rate-limit.decorator';
import { PublicQueueService } from './public-queue.service';
import { PublicRoutingService } from './public-routing.service';

@Controller('public')
export class PublicRoutingController {
  constructor(
    private readonly publicRouting: PublicRoutingService,
    private readonly publicQueue: PublicQueueService,
  ) {}

  @RateLimit({
    id: 'public-doctor-route',
    limit: 120,
    windowMs: 60 * 1000,
    subject: { kind: 'NONE' },
  })
  @Get('doctors/:publicIdentifier')
  getDoctor(@Param('publicIdentifier') publicIdentifier: string) {
    return this.publicRouting.getDoctorPublicRoute(publicIdentifier);
  }

  @RateLimit({
    id: 'public-practice-location-route',
    limit: 120,
    windowMs: 60 * 1000,
    subject: { kind: 'NONE' },
  })
  @Get('practice-locations/:publicIdentifier')
  getPracticeLocation(@Param('publicIdentifier') publicIdentifier: string) {
    return this.publicRouting.getPracticeLocationPublicRoute(publicIdentifier);
  }

  @RateLimit({
    id: 'public-queue-route',
    limit: 120,
    windowMs: 60 * 1000,
    subject: { kind: 'PARAM', field: 'publicIdentifier' },
  })
  @Get('practice-locations/:publicIdentifier/queue/:serviceDate')
  getPublicQueue(
    @Param('publicIdentifier') publicIdentifier: string,
    @Param('serviceDate') serviceDate: string,
  ) {
    return this.publicQueue.getPublicQueue(publicIdentifier, serviceDate);
  }
}
