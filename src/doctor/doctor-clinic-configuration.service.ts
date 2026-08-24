import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { BookingQuestionType, Prisma, ServiceAvailabilityStatus } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SaveDoctorBookingQuestionTemplateDto } from './dto/save-doctor-booking-question-template.dto';
import { SaveDoctorServiceTemplateDto } from './dto/save-doctor-service-template.dto';

const MAX_ACTIVE_BOOKING_QUESTIONS = 5;

@Injectable()
export class DoctorClinicConfigurationService {
  constructor(private readonly prisma: PrismaService) {}

  async list(authenticatedUserId: string, practiceLocationId: string) {
    await this.requireOwnedLocation(authenticatedUserId, practiceLocationId);
    const [services, bookingQuestions] = await Promise.all([
      this.prisma.practiceLocationService.findMany({
        where: { practiceLocationId },
        orderBy: [{ status: 'asc' }, { name: 'asc' }, { id: 'asc' }],
      }),
      this.prisma.bookingQuestion.findMany({
        where: { practiceLocationId },
        orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }],
      }),
    ]);
    return { services, bookingQuestions };
  }

  async createService(authenticatedUserId: string, practiceLocationId: string, dto: SaveDoctorServiceTemplateDto) {
    await this.requireOwnedLocation(authenticatedUserId, practiceLocationId);
    return this.prisma.practiceLocationService.create({
      data: { practiceLocationId, ...this.normalizeService(dto) },
    });
  }

  async updateService(authenticatedUserId: string, practiceLocationId: string, serviceId: string, dto: SaveDoctorServiceTemplateDto) {
    await this.requireOwnedLocation(authenticatedUserId, practiceLocationId);
    const existing = await this.prisma.practiceLocationService.findFirst({ where: { id: serviceId, practiceLocationId }, select: { id: true } });
    if (!existing) throw new NotFoundException('Clinic Service was not found.');
    return this.prisma.practiceLocationService.update({ where: { id: serviceId }, data: this.normalizeService(dto) });
  }

  async createBookingQuestion(authenticatedUserId: string, practiceLocationId: string, dto: SaveDoctorBookingQuestionTemplateDto) {
    await this.requireOwnedLocation(authenticatedUserId, practiceLocationId);
    const data = this.normalizeQuestion(dto);
    await this.assertQuestionState(practiceLocationId, null, data.displayOrder, data.isActive);
    return this.prisma.bookingQuestion.create({ data: { practiceLocationId, ...data } });
  }

  async updateBookingQuestion(authenticatedUserId: string, practiceLocationId: string, questionId: string, dto: SaveDoctorBookingQuestionTemplateDto) {
    await this.requireOwnedLocation(authenticatedUserId, practiceLocationId);
    const existing = await this.prisma.bookingQuestion.findFirst({ where: { id: questionId, practiceLocationId } });
    if (!existing) throw new NotFoundException('Clinic BookingQuestion was not found.');
    const data = this.normalizeQuestion(dto);
    await this.assertQuestionState(practiceLocationId, questionId, data.displayOrder, data.isActive);
    await this.assertHistoricalMeaningPreserved(questionId, existing, data);
    return this.prisma.bookingQuestion.update({ where: { id: questionId }, data });
  }

  private async requireOwnedLocation(authenticatedUserId: string, practiceLocationId: string) {
    const location = await this.prisma.practiceLocation.findFirst({
      where: { id: practiceLocationId, doctorProfile: { userId: authenticatedUserId } },
      select: { id: true, lifecycleStatus: true },
    });
    if (!location) throw new ForbiddenException('Only the owning Doctor may manage clinic configuration.');
    if (location.lifecycleStatus === 'PERMANENTLY_DELETED') throw new ConflictException('A permanently deleted clinic cannot be configured.');
    return location;
  }

  private normalizeService(dto: SaveDoctorServiceTemplateDto) {
    const name = dto.name.trim();
    if (!name) throw new BadRequestException('Service name is required.');
    if (!Number.isInteger(dto.durationMinutes) || dto.durationMinutes < 1 || dto.durationMinutes > 1440) throw new BadRequestException('Service duration must be between 1 and 1440 whole minutes.');
    if (dto.status !== ServiceAvailabilityStatus.ACTIVE && dto.status !== ServiceAvailabilityStatus.INACTIVE) throw new BadRequestException('Service availability status is invalid.');
    return { name, durationMinutes: dto.durationMinutes, status: dto.status };
  }

  private normalizeQuestion(dto: SaveDoctorBookingQuestionTemplateDto) {
    const questionText = dto.questionText.trim();
    const helpText = dto.helpText?.trim() || null;
    if (!questionText) throw new BadRequestException('Booking question text is required.');
    if (!Number.isInteger(dto.displayOrder) || dto.displayOrder < 0) throw new BadRequestException('Display order must be zero or greater.');

    let textMaximumLength: number | null = null;
    let numberMinimum: Prisma.Decimal | null = null;
    let numberMaximum: Prisma.Decimal | null = null;
    let selectOptions: Prisma.InputJsonValue | typeof Prisma.DbNull = Prisma.DbNull;

    if (dto.type === BookingQuestionType.TEXT) {
      textMaximumLength = dto.textMaximumLength ?? null;
    } else if (dto.type === BookingQuestionType.NUMBER) {
      if (dto.numberMinimum !== undefined && dto.numberMaximum !== undefined && dto.numberMinimum > dto.numberMaximum) throw new BadRequestException('Number minimum must not exceed number maximum.');
      numberMinimum = dto.numberMinimum === undefined ? null : new Prisma.Decimal(dto.numberMinimum);
      numberMaximum = dto.numberMaximum === undefined ? null : new Prisma.Decimal(dto.numberMaximum);
    } else if (dto.type === BookingQuestionType.BOOLEAN) {
      // no type-specific values
    } else if (dto.type === BookingQuestionType.SINGLE_SELECT) {
      const options = dto.selectOptions;
      if (!options || options.length < 2) throw new BadRequestException('SINGLE_SELECT questions require at least two options.');
      const normalized = options.map((option) => ({ value: option.value.trim(), label: option.label.trim() }));
      if (normalized.some((option) => !option.value || !option.label) || new Set(normalized.map((option) => option.value)).size !== normalized.length) throw new BadRequestException('Select option values and labels must be present and values must be unique.');
      selectOptions = normalized;
    } else {
      throw new BadRequestException('Booking question type is invalid.');
    }

    return {
      questionText,
      helpText,
      type: dto.type,
      isRequired: dto.isRequired,
      displayOrder: dto.displayOrder,
      isActive: dto.isActive,
      estimatedMinutesAdjustment: 0,
      textMaximumLength,
      numberMinimum,
      numberMaximum,
      selectOptions,
    };
  }

  private async assertQuestionState(practiceLocationId: string, currentId: string | null, displayOrder: number, isActive: boolean) {
    const orderConflict = await this.prisma.bookingQuestion.findFirst({ where: { practiceLocationId, displayOrder, ...(currentId ? { id: { not: currentId } } : {}) }, select: { id: true } });
    if (orderConflict) throw new ConflictException('BookingQuestion display order must be unique within the practice location.');
    if (!isActive) return;
    const count = await this.prisma.bookingQuestion.count({ where: { practiceLocationId, isActive: true, ...(currentId ? { id: { not: currentId } } : {}) } });
    if (count >= MAX_ACTIVE_BOOKING_QUESTIONS) throw new ConflictException('A practice location may have at most five active BookingQuestions.');
  }

  private async assertHistoricalMeaningPreserved(questionId: string, existing: Record<string, unknown>, next: Record<string, unknown>) {
    const rows = await this.prisma.$queryRaw<Array<{ hasHistory: boolean }>>(Prisma.sql`
      SELECT (
        EXISTS (SELECT 1 FROM "BookingDraftAnswer" WHERE "bookingQuestionId" = ${questionId})
        OR EXISTS (SELECT 1 FROM "AppointmentAnswer" WHERE "bookingQuestionId" = ${questionId})
      ) AS "hasHistory"
    `);
    if (!rows[0]?.hasHistory) return;
    const materialKeys = ['questionText', 'type', 'textMaximumLength', 'numberMinimum', 'numberMaximum', 'selectOptions'];
    const changed = materialKeys.some((key) => JSON.stringify(existing[key]) !== JSON.stringify(next[key]));
    if (changed) throw new ConflictException('This BookingQuestion already has answer history. Its historical meaning cannot be materially redefined; create a new question and deactivate the old one instead.');
  }
}
