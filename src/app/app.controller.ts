import { Controller, Get } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Controller('app')
export class AppController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('health')
  async health() {
    const userCount = await this.prisma.user.count();

    return {
      status: 'OK',
      message: 'Clinic Queueing SaaS API is running',
      userCount,
    };
  }
}
