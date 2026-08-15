import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { SecretaryLifecycleService } from './secretary-lifecycle.service';
import { SecretaryController } from './secretary.controller';

@Module({
  imports: [PrismaModule, AuthModule],
  providers: [SecretaryLifecycleService],
  controllers: [SecretaryController],
})
export class SecretaryModule {}
