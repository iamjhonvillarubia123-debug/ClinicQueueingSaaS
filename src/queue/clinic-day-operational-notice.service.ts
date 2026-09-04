import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AdministrativeRestrictionStatus,
  ClinicDayOperationalNoticeKind,
  ClinicDayOperationalNoticeStatus,
  ClinicDayStatus,
  CommandType,
  Prisma,
  UserAccountStatus,
} from '../../generated/prisma/client';
import { CommandIdempotencyService } from '../idempotency/command-idempotency.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  EndClinicDayOperationalNoticeDto,
  StartClinicDayOperationalNoticeDto,
} from './dto/clinic-day-operational-notice.dto';

@Injectable()
export class ClinicDayOperationalNoticeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly idempotency: CommandIdempotencyService,
  ) {}

  async start(
    actorUserId: string,
    dto: StartClinicDayOperationalNoticeDto,
    rawKey?: string,
  ) {
    const key = this.idempotency.normalizeKey(rawKey);
    const serviceDate = this.parseDate(dto.serviceDate);
    const expectedResumeAt = new Date(dto.expectedResumeAt);
    if (expectedResumeAt.getTime() <= Date.now())
      throw new ConflictException(
        'Expected resume time must be in the future.',
      );
    const identity = this.idempotency.deriveIdentity({
      idempotencyKey: key,
      commandType: CommandType.START_CLINIC_DAY_OPERATIONAL_NOTICE,
      scope: { actorUserId, practiceLocationId: dto.practiceLocationId },
    });
    const fingerprint = this.idempotency.fingerprint({
      actorUserId,
      practiceLocationId: dto.practiceLocationId,
      serviceDate: dto.serviceDate,
      kind: dto.kind,
      reason: dto.reason,
      message: dto.message,
      expectedResumeAt: dto.expectedResumeAt,
    });
    return this.prisma.$transaction(async (tx) => {
      await this.idempotency.acquireCommandLock(tx, identity);
      const replay = await this.idempotency.findReplay(
        tx,
        identity,
        fingerprint,
      );
      const day = await this.loadAuthorizedDay(
        tx,
        actorUserId,
        dto.practiceLocationId,
        serviceDate,
      );
      if (replay)
        return {
          notice: await tx.clinicDayOperationalNotice.findFirstOrThrow({
            where: { clinicDayId: day.id },
            orderBy: { createdAt: 'desc' },
          }),
          replayed: true,
        };
      if (
        dto.kind === ClinicDayOperationalNoticeKind.DELAYED_OPENING &&
        day.status !== ClinicDayStatus.NOT_STARTED &&
        day.status !== ClinicDayStatus.DELAYED
      )
        throw new ConflictException(
          'Opening delay can only be declared before the clinic starts.',
        );
      if (
        dto.kind === ClinicDayOperationalNoticeKind.SERVING_BREAK &&
        day.status !== ClinicDayStatus.STARTED
      )
        throw new ConflictException(
          'A serving break requires a started clinic day.',
        );
      const active = await tx.clinicDayOperationalNotice.findFirst({
        where: {
          clinicDayId: day.id,
          status: ClinicDayOperationalNoticeStatus.ACTIVE,
        },
      });
      if (active)
        throw new ConflictException(
          'An operational notice is already active for this clinic day.',
        );
      const now = new Date();
      const notice = await tx.clinicDayOperationalNotice.create({
        data: {
          clinicDayId: day.id,
          practiceLocationId: dto.practiceLocationId,
          serviceDate,
          kind: dto.kind,
          reason: dto.reason.trim(),
          message: dto.message?.trim() || null,
          startsAt: now,
          expectedResumeAt,
          createdByUserId: actorUserId,
          activeNoticeKey: day.id,
        },
      });
      if (dto.kind === ClinicDayOperationalNoticeKind.DELAYED_OPENING)
        await tx.clinicDay.update({
          where: { id: day.id },
          data: {
            status: ClinicDayStatus.DELAYED,
            openingOverrideAt: expectedResumeAt,
            delayedOpeningDeclaredAt: now,
          },
        });
      const times = this.idempotency.completionTimes(now);
      await tx.commandIdempotency.create({
        data: {
          commandType: CommandType.START_CLINIC_DAY_OPERATIONAL_NOTICE,
          idempotencyKey: key,
          commandIdentityKey: identity,
          requestFingerprint: fingerprint,
          practiceLocationId: dto.practiceLocationId,
          serviceDate,
          actorUserId,
          ...times,
        },
      });
      return { notice, replayed: false };
    });
  }

  async end(
    actorUserId: string,
    dto: EndClinicDayOperationalNoticeDto,
    rawKey?: string,
  ) {
    const key = this.idempotency.normalizeKey(rawKey);
    const identity = this.idempotency.deriveIdentity({
      idempotencyKey: key,
      commandType: CommandType.END_CLINIC_DAY_OPERATIONAL_NOTICE,
      scope: { actorUserId, noticeId: dto.noticeId },
    });
    const fingerprint = this.idempotency.fingerprint({
      actorUserId,
      noticeId: dto.noticeId,
    });
    return this.prisma.$transaction(async (tx) => {
      await this.idempotency.acquireCommandLock(tx, identity);
      const existing = await tx.clinicDayOperationalNotice.findUnique({
        where: { id: dto.noticeId },
      });
      if (!existing)
        throw new NotFoundException('Operational notice was not found.');
      await this.loadAuthorizedDay(
        tx,
        actorUserId,
        existing.practiceLocationId,
        existing.serviceDate,
      );
      const replay = await this.idempotency.findReplay(
        tx,
        identity,
        fingerprint,
      );
      if (replay) return { notice: existing, replayed: true };
      if (existing.status !== ClinicDayOperationalNoticeStatus.ACTIVE)
        throw new ConflictException('Operational notice has already ended.');
      const now = new Date();
      const notice = await tx.clinicDayOperationalNotice.update({
        where: { id: existing.id },
        data: {
          status: ClinicDayOperationalNoticeStatus.ENDED,
          endedAt: now,
          endedByUserId: actorUserId,
          activeNoticeKey: null,
        },
      });
      const times = this.idempotency.completionTimes(now);
      await tx.commandIdempotency.create({
        data: {
          commandType: CommandType.END_CLINIC_DAY_OPERATIONAL_NOTICE,
          idempotencyKey: key,
          commandIdentityKey: identity,
          requestFingerprint: fingerprint,
          practiceLocationId: existing.practiceLocationId,
          serviceDate: existing.serviceDate,
          actorUserId,
          ...times,
        },
      });
      return { notice, replayed: false };
    });
  }

  private async loadAuthorizedDay(
    tx: Prisma.TransactionClient,
    actorUserId: string,
    practiceLocationId: string,
    serviceDate: Date,
  ) {
    const location = await tx.practiceLocation.findUnique({
      where: { id: practiceLocationId },
      select: {
        doctorProfile: { select: { userId: true } },
        clinicDays: {
          where: { serviceDate },
          select: {
            id: true,
            status: true,
            operatingPracticeStaff: {
              select: { userId: true, isActive: true },
            },
          },
          take: 1,
        },
      },
    });
    if (!location)
      throw new NotFoundException('Practice location was not found.');
    const actor = await tx.user.findUnique({
      where: { id: actorUserId },
      select: { accountStatus: true, administrativeRestrictionStatus: true },
    });
    const day = location.clinicDays[0];
    const authorized =
      actor?.accountStatus === UserAccountStatus.ACTIVE &&
      actor.administrativeRestrictionStatus ===
        AdministrativeRestrictionStatus.NONE &&
      (location.doctorProfile.userId === actorUserId ||
        (day?.operatingPracticeStaff?.isActive &&
          day.operatingPracticeStaff.userId === actorUserId));
    if (!authorized)
      throw new ForbiddenException(
        'Current user cannot manage operational notices for this clinic day.',
      );
    if (!day) throw new ConflictException('Clinic day has not been created.');
    return day;
  }

  private parseDate(value: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value))
      throw new ConflictException('Service Date is invalid.');
    const date = new Date(`${value}T00:00:00.000Z`);
    if (
      Number.isNaN(date.getTime()) ||
      date.toISOString().slice(0, 10) !== value
    )
      throw new ConflictException('Service Date is invalid.');
    return date;
  }
}
