import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { MobileNumberModule } from '../security/mobile-number/mobile-number.module';
import { SecretaryInvitationService } from './secretary-invitation.service';
import { SecretaryLifecycleService } from './secretary-lifecycle.service';
import { SecretaryController } from './secretary.controller';

@Module({
  imports: [PrismaModule, AuthModule, MobileNumberModule],
  providers: [SecretaryLifecycleService, SecretaryInvitationService],
  controllers: [SecretaryController],
})
export class SecretaryModule {}
