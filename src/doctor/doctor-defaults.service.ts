import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  BookingQuestionType,
  Prisma,
  ServiceAvailabilityStatus,
} from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SaveDoctorBookingQuestionTemplateDto } from './dto/save-doctor-booking-question-template.dto';
import { SaveDoctorServiceTemplateDto } from './dto/save-doctor-service-template.dto';

const MAX_ACTIVE_BOOKING_QUESTIONS = 5;
const MAX_SERVICE_DURATION_MINUTES = 24 * 60;

@Injectable()
export class DoctorDefaultsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(authenticatedUserId: string) {
    const doctorProfileId =
      await this.requireDoctorProfileId(authenticatedUserId);
    const [services, bookingQuestions] = await Promise.all([
      this.prisma.doctorServiceTemplate.findMany({
        where: { doctorProfileId },
        orderBy: [{ status: 'asc' }, { name: 'asc' }, { id: 'asc' }],
      }),
      this.prisma.doctorBookingQuestionTemplate.findMany({
        where: { doctorProfileId },
        orderBy: [{ displayOrder: 'asc' }, { id: 'asc' }],
      }),
    ]);
    return { services, bookingQuestions };
  }

  async createServiceTemplate(
    authenticatedUserId: string,
    dto: SaveDoctorServiceTemplateDto,
  ) {
    return this.mutate(authenticatedUserId, async (tx, doctorProfileId) => {
      const data = this.normalizeService(dto);
      return tx.doctorServiceTemplate.create({
        data: { doctorProfileId, ...data },
      });
    });
  }
  async updateServiceTemplate(
    authenticatedUserId: string,
    templateId: string,
    dto: SaveDoctorServiceTemplateDto,
  ) {
    return this.mutate(authenticatedUserId, async (tx, doctorProfileId) => {
      const template = await tx.doctorServiceTemplate.findFirst({
        where: { id: templateId, doctorProfileId },
        select: { id: true },
      });
      if (!template) {
        throw new NotFoundException('Doctor Service template was not found.');
      }
      return tx.doctorServiceTemplate.update({
        where: { id: template.id },
        data: this.normalizeService(dto),
      });
    });
  }
  async createBookingQuestionTemplate(
    authenticatedUserId: string,
    dto: SaveDoctorBookingQuestionTemplateDto,
  ) {
    return this.mutate(authenticatedUserId, async (tx, doctorProfileId) => {
      const data = this.normalizeBookingQuestion(dto);
      await this.assertBookingQuestionTemplateState(
        tx,
        doctorProfileId,
        null,
        data.proposedDisplayOrder,
        data.proposedIsActive,
      );
      return tx.doctorBookingQuestionTemplate.create({
        data: {
          doctorProfileId,
          questionText: data.proposedQuestionText,
          helpText: data.proposedHelpText,
          type: data.proposedType,
          isRequired: data.proposedIsRequired,
          displayOrder: data.proposedDisplayOrder,
          isActive: data.proposedIsActive,
          estimatedMinutesAdjustment: 0,
          textMaximumLength: data.proposedTextMaximumLength,
          numberMinimum: data.proposedNumberMinimum,
          numberMaximum: data.proposedNumberMaximum,
          selectOptions: data.proposedSelectOptions,
        },
      });
    });
  }
  async updateBookingQuestionTemplate(
    authenticatedUserId: string,
    templateId: string,
    dto: SaveDoctorBookingQuestionTemplateDto,
  ) {
    return this.mutate(authenticatedUserId, async (tx, doctorProfileId) => {
      const template = await tx.doctorBookingQuestionTemplate.findFirst({
        where: { id: templateId, doctorProfileId },
        select: { id: true },
      });
      if (!template) {
        throw new NotFoundException(
          'Doctor BookingQuestion template was not found.',
        );
      }
      const data = this.normalizeBookingQuestion(dto);
      await this.assertBookingQuestionTemplateState(
        tx,
        doctorProfileId,
        template.id,
        data.proposedDisplayOrder,
        data.proposedIsActive,
      );
      return tx.doctorBookingQuestionTemplate.update({
        where: { id: template.id },
        data: {
          questionText: data.proposedQuestionText,
          helpText: data.proposedHelpText,
          type: data.proposedType,
          isRequired: data.proposedIsRequired,
          displayOrder: data.proposedDisplayOrder,
          isActive: data.proposedIsActive,
          estimatedMinutesAdjustment: 0,
          textMaximumLength: data.proposedTextMaximumLength,
          numberMinimum: data.proposedNumberMinimum,
          numberMaximum: data.proposedNumberMaximum,
          selectOptions: data.proposedSelectOptions,
        },
      });
    });
  }
  async removeTemplate(
    userId: string,
    kind: 'services' | 'questions',
    templateId: string,
  ) {
    return this.mutate(userId, async (tx, doctorProfileId) => {
      const result =
        kind === 'services'
          ? await tx.doctorServiceTemplate.deleteMany({
              where: { id: templateId, doctorProfileId },
            })
          : await tx.doctorBookingQuestionTemplate.deleteMany({
              where: { id: templateId, doctorProfileId },
            });
      if (!result.count)
        throw new NotFoundException('Default template was not found.');
      return { removed: true, clinicCopiesUnchanged: true };
    });
  }

  async reorderQuestions(userId: string, ids: string[]) {
    return this.mutate(userId, async (tx, doctorProfileId) => {
      const current = await tx.doctorBookingQuestionTemplate.findMany({
        where: { doctorProfileId },
        select: { id: true, displayOrder: true },
      });
      if (
        !Array.isArray(ids) ||
        new Set(ids).size !== ids.length ||
        ids.length !== current.length ||
        ids.some((id) => !current.some((item) => item.id === id))
      )
        throw new ConflictException(
          'The template list changed. Reload and reorder your current templates.',
        );
      // Move to unused positive positions before assigning the final unique order.
      const offset =
        Math.max(0, ...current.map((item) => item.displayOrder)) + 1;
      for (let index = 0; index < ids.length; index++)
        await tx.doctorBookingQuestionTemplate.update({
          where: { id: ids[index] },
          data: { displayOrder: offset + index },
        });
      for (let index = 0; index < ids.length; index++)
        await tx.doctorBookingQuestionTemplate.update({
          where: { id: ids[index] },
          data: { displayOrder: index },
        });
      return { reordered: true, clinicCopiesUnchanged: true };
    });
  }

  private async mutate<T>(
    userId: string,
    operation: (
      tx: Prisma.TransactionClient,
      doctorProfileId: string,
    ) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      const users = await tx.$queryRaw<
        { id: string }[]
      >`SELECT "id" FROM "User" WHERE "id" = ${userId} AND "role" = 'DOCTOR' AND "accountStatus" = 'ACTIVE' AND "administrativeRestrictionStatus" = 'NONE' FOR UPDATE`;
      if (!users.length)
        throw new ForbiddenException('Active Doctor authority is required.');
      const profile = await tx.doctorProfile.findUnique({
        where: { userId },
        select: { id: true },
      });
      if (!profile) throw new ForbiddenException('Doctor profile is required.');
      return operation(tx, profile.id);
    });
  }

  private async requireDoctorProfileId(authenticatedUserId: string) {
    const doctor = await this.prisma.doctorProfile.findUnique({
      where: { userId: authenticatedUserId },
      select: { id: true },
    });
    if (!doctor) {
      throw new ForbiddenException(
        'Only a Doctor may manage Doctor-wide defaults.',
      );
    }
    return doctor.id;
  }

  private normalizeService(dto: SaveDoctorServiceTemplateDto) {
    const name = dto.name.trim();
    if (!name) {
      throw new BadRequestException('Service name is required.');
    }
    if (name.length > 150) {
      throw new BadRequestException(
        'Service name must not exceed 150 characters.',
      );
    }
    if (
      !Number.isInteger(dto.durationMinutes) ||
      dto.durationMinutes <= 0 ||
      dto.durationMinutes > MAX_SERVICE_DURATION_MINUTES
    ) {
      throw new BadRequestException(
        'Service duration must be between 1 and 1440 whole minutes.',
      );
    }
    if (
      dto.status !== ServiceAvailabilityStatus.ACTIVE &&
      dto.status !== ServiceAvailabilityStatus.INACTIVE
    ) {
      throw new BadRequestException('Service availability status is invalid.');
    }
    return { name, durationMinutes: dto.durationMinutes, status: dto.status };
  }

  private async assertBookingQuestionTemplateState(
    tx: Prisma.TransactionClient,
    doctorProfileId: string,
    currentTemplateId: string | null,
    displayOrder: number,
    isActive: boolean,
  ) {
    const orderConflict = await tx.doctorBookingQuestionTemplate.findFirst({
      where: {
        doctorProfileId,
        displayOrder,
        ...(currentTemplateId ? { id: { not: currentTemplateId } } : {}),
      },
      select: { id: true },
    });
    if (orderConflict) {
      throw new ConflictException(
        'Doctor BookingQuestion display order must be unique.',
      );
    }
    if (!isActive) return;
    const activeCount = await tx.doctorBookingQuestionTemplate.count({
      where: {
        doctorProfileId,
        isActive: true,
        ...(currentTemplateId ? { id: { not: currentTemplateId } } : {}),
      },
    });
    if (activeCount >= MAX_ACTIVE_BOOKING_QUESTIONS) {
      throw new ConflictException(
        'A Doctor-wide default may contain at most five active BookingQuestions.',
      );
    }
  }

  private normalizeBookingQuestion(dto: SaveDoctorBookingQuestionTemplateDto) {
    const questionText = dto.questionText.trim();
    const helpText = dto.helpText?.trim() || null;
    if (!questionText) {
      throw new BadRequestException('Booking question text is required.');
    }
    if (questionText.length > 500 || (helpText?.length ?? 0) > 500) {
      throw new BadRequestException('Booking question text is too long.');
    }
    if (!Number.isInteger(dto.displayOrder) || dto.displayOrder < 0) {
      throw new BadRequestException('Display order must be zero or greater.');
    }

    const typeFields = this.normalizeTypeFields(dto);
    return {
      proposedQuestionText: questionText,
      proposedHelpText: helpText,
      proposedType: dto.type,
      proposedIsRequired: dto.isRequired,
      proposedDisplayOrder: dto.displayOrder,
      proposedIsActive: dto.isActive,
      ...typeFields,
    };
  }

  private normalizeTypeFields(dto: SaveDoctorBookingQuestionTemplateDto) {
    if (dto.type === BookingQuestionType.TEXT) {
      if (
        dto.numberMinimum !== undefined ||
        dto.numberMaximum !== undefined ||
        dto.selectOptions !== undefined
      ) {
        throw new BadRequestException(
          'TEXT questions may only use textMaximumLength.',
        );
      }
      return {
        proposedTextMaximumLength: dto.textMaximumLength ?? null,
        proposedNumberMinimum: null,
        proposedNumberMaximum: null,
        proposedSelectOptions: Prisma.JsonNull,
      };
    }

    if (dto.type === BookingQuestionType.NUMBER) {
      if (
        dto.textMaximumLength !== undefined ||
        dto.selectOptions !== undefined
      ) {
        throw new BadRequestException(
          'NUMBER questions may only use numeric limits.',
        );
      }
      if (
        dto.numberMinimum !== undefined &&
        dto.numberMaximum !== undefined &&
        dto.numberMinimum > dto.numberMaximum
      ) {
        throw new BadRequestException(
          'Number minimum must not exceed number maximum.',
        );
      }
      return {
        proposedTextMaximumLength: null,
        proposedNumberMinimum: dto.numberMinimum ?? null,
        proposedNumberMaximum: dto.numberMaximum ?? null,
        proposedSelectOptions: Prisma.JsonNull,
      };
    }

    if (dto.type === BookingQuestionType.BOOLEAN) {
      if (
        dto.textMaximumLength !== undefined ||
        dto.numberMinimum !== undefined ||
        dto.numberMaximum !== undefined ||
        dto.selectOptions !== undefined
      ) {
        throw new BadRequestException(
          'BOOLEAN questions do not accept validation fields.',
        );
      }
      return {
        proposedTextMaximumLength: null,
        proposedNumberMinimum: null,
        proposedNumberMaximum: null,
        proposedSelectOptions: Prisma.JsonNull,
      };
    }

    if (dto.type !== BookingQuestionType.SINGLE_SELECT) {
      throw new BadRequestException('Booking question type is invalid.');
    }
    if (
      dto.textMaximumLength !== undefined ||
      dto.numberMinimum !== undefined ||
      dto.numberMaximum !== undefined
    ) {
      throw new BadRequestException(
        'SINGLE_SELECT questions may only use selectOptions.',
      );
    }
    const options = dto.selectOptions;
    if (!options || options.length < 2) {
      throw new BadRequestException(
        'SINGLE_SELECT questions require at least two options.',
      );
    }
    const normalized = options.map((option) => ({
      value: option.value.trim(),
      label: option.label.trim(),
    }));
    const values = new Set<string>();
    for (const option of normalized) {
      if (!option.value || !option.label) {
        throw new BadRequestException(
          'Select option values and labels are required.',
        );
      }
      if (option.value.length > 100 || option.label.length > 200) {
        throw new BadRequestException(
          'Select option value or label is too long.',
        );
      }
      if (values.has(option.value)) {
        throw new BadRequestException('Select option values must be unique.');
      }
      values.add(option.value);
    }
    return {
      proposedTextMaximumLength: null,
      proposedNumberMinimum: null,
      proposedNumberMaximum: null,
      proposedSelectOptions: normalized,
    };
  }
}
