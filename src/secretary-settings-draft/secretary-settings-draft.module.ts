import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { SecretarySettingsDraftController } from './secretary-settings-draft.controller';
import { SecretarySettingsDraftScheduleService } from './secretary-settings-draft-schedule.service';
import { SecretarySettingsDraftService } from './secretary-settings-draft.service';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [SecretarySettingsDraftController],
  providers: [
    SecretarySettingsDraftService,
    SecretarySettingsDraftScheduleService,
  ],
})
export class SecretarySettingsDraftModule {}
