import { Controller, Get, Param } from '@nestjs/common';
import { PublicRoutingService } from './public-routing.service';

@Controller('public')
export class PublicRoutingController {
  constructor(private readonly publicRouting: PublicRoutingService) {}

  @Get('doctors/:publicIdentifier')
  getDoctor(@Param('publicIdentifier') publicIdentifier: string) {
    return this.publicRouting.getDoctorPublicRoute(publicIdentifier);
  }

  @Get('practice-locations/:publicIdentifier')
  getPracticeLocation(@Param('publicIdentifier') publicIdentifier: string) {
    return this.publicRouting.getPracticeLocationPublicRoute(publicIdentifier);
  }
}
