import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { ScheduleModule } from '../schedule/schedule.module';
import { SecretarySettingsDraftApprovalService } from './secretary-settings-draft-approval.service';
import { SecretarySettingsDraftBookingQuestionService } from './secretary-settings-draft-booking-question.service';
import { SecretarySettingsDraftController } from './secretary-settings-draft.controller';
import { SecretarySettingsDraftExceptionService } from './secretary-settings-draft-exception.service';
import { SecretarySettingsDraftScheduleService } from './secretary-settings-draft-schedule.service';
import { SecretarySettingsDraftServiceProposalService } from './secretary-settings-draft-service.service';
import { SecretarySettingsDraftService } from './secretary-settings-draft.service';

@Module({
  imports: [PrismaModule, AuthModule, ScheduleModule],
  controllers: [SecretarySettingsDraftController],
  providers: [
    SecretarySettingsDraftService,
    SecretarySettingsDraftScheduleService,
    SecretarySettingsDraftExceptionService,
    SecretarySettingsDraftServiceProposalService,
    SecretarySettingsDraftBookingQuestionService,
    SecretarySettingsDraftApprovalService,
  ],
})
export class SecretarySettingsDraftModule {}
