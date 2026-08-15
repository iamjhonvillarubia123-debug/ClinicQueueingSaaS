import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { SystemAdminController } from './system-admin.controller';
import { SystemAdminService } from './system-admin.service';

@Module({
  imports: [PrismaModule, AuthModule],
  providers: [SystemAdminService],
  controllers: [SystemAdminController],
})
export class SystemAdminModule {}
