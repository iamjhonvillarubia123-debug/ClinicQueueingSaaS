import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { MobileNumberModule } from '../security/mobile-number/mobile-number.module';
import { SecretaryInvitationService } from './secretary-invitation.service';
import { SecretaryLifecycleService } from './secretary-lifecycle.service';
import { SecretaryReplacementInvitationController } from './secretary-replacement-invitation.controller';
import { SecretaryReplacementInvitationService } from './secretary-replacement-invitation.service';
import { SecretaryController } from './secretary.controller';

@Module({
  imports: [PrismaModule, AuthModule, MobileNumberModule],
  providers: [
    SecretaryLifecycleService,
    SecretaryInvitationService,
    SecretaryReplacementInvitationService,
  ],
  controllers: [SecretaryController, SecretaryReplacementInvitationController],
})
export class SecretaryModule {}
