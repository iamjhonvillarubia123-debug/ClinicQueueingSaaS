import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { SecretaryWorkspaceController } from './secretary-workspace.controller';
import { SecretaryWorkspaceService } from './secretary-workspace.service';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [SecretaryWorkspaceController],
  providers: [SecretaryWorkspaceService],
})
export class SecretaryWorkspaceModule {}
