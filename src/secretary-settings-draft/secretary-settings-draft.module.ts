import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { ScheduleModule } from '../schedule/schedule.module';
import { SecretarySettingsDraftController } from './secretary-settings-draft.controller';
import { SecretarySettingsDraftExceptionService } from './secretary-settings-draft-exception.service';
import { SecretarySettingsDraftScheduleService } from './secretary-settings-draft-schedule.service';
import { SecretarySettingsDraftService } from './secretary-settings-draft.service';

@Module({
  imports: [PrismaModule, AuthModule, ScheduleModule],
  controllers: [SecretarySettingsDraftController],
  providers: [
    SecretarySettingsDraftService,
    SecretarySettingsDraftScheduleService,
    SecretarySettingsDraftExceptionService,
  ],
})
export class SecretarySettingsDraftModule {}
