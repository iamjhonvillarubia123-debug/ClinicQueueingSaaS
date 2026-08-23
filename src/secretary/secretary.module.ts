import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { SecretaryLifecycleService } from './secretary-lifecycle.service';
import { SecretaryRegistrationService } from './secretary-registration.service';
import { SecretaryController } from './secretary.controller';

@Module({
  imports: [PrismaModule, AuthModule],
  providers: [SecretaryLifecycleService, SecretaryRegistrationService],
  controllers: [SecretaryController],
})
export class SecretaryModule {}
