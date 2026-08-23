import { Module } from '@nestjs/common';

import { PrismaModule } from '../prisma/prisma.module';
import { SecretaryWorkspaceController } from './secretary-workspace.controller';
import { SecretaryWorkspaceService } from './secretary-workspace.service';

@Module({
  imports: [PrismaModule],
  controllers: [SecretaryWorkspaceController],
  providers: [SecretaryWorkspaceService],
})
export class SecretaryWorkspaceModule {}
