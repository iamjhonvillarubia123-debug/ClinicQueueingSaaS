import {
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { ClinicDayOperationalNoticeKind } from '../../../generated/prisma/client';

export class StartClinicDayOperationalNoticeDto {
  @IsUUID() practiceLocationId!: string;
  @IsDateString({ strict: true }) serviceDate!: string;
  @IsEnum(ClinicDayOperationalNoticeKind) kind!: ClinicDayOperationalNoticeKind;
  @IsString() @IsNotEmpty() @MaxLength(120) reason!: string;
  @IsOptional() @IsString() @MaxLength(500) message?: string;
  @IsDateString() expectedResumeAt!: string;
}

export class EndClinicDayOperationalNoticeDto {
  @IsUUID() noticeId!: string;
}
