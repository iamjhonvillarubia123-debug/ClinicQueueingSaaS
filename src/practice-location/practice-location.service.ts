import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  BookingQuestionType,
  PracticeLocationLifecycleStatus,
  Prisma,
} from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePracticeLocationDto } from './dto/create-practice-location.dto';
import { UpdatePracticeLocationDto } from './dto/update-practice-location.dto';

@Injectable()
export class PracticeLocationService {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    userId: string,
    createPracticeLocationDto: CreatePracticeLocationDto,
  ) {
    const doctorProfile = await this.prisma.doctorProfile.findUnique({
      where: { userId },
      select: { id: true },
    });

    if (!doctorProfile) {
      throw new ForbiddenException(
        'Only a doctor may create a practice location.',
      );
    }

    const name = this.normalizeOptionalText(createPracticeLocationDto.name);
    const shortCode =
      this.normalizeOptionalText(createPracticeLocationDto.shortCode)?.toUpperCase() ??
      null;
    const addressLine1 = this.normalizeOptionalText(
      createPracticeLocationDto.addressLine1,
    );

    return this.prisma.$transaction(async (transaction) => {
      if (name && addressLine1) {
        const existingLocation = await transaction.practiceLocation.findFirst({
          where: {
            doctorProfileId: doctorProfile.id,
            lifecycleStatus: PracticeLocationLifecycleStatus.ACTIVE,
            name: { equals: name, mode: 'insensitive' },
            addressLine1: { equals: addressLine1, mode: 'insensitive' },
          },
          select: { id: true },
        });

        if (existingLocation) {
          throw new ConflictException(
            'An active practice location with this name and address already exists.',
          );
        }
      }

      if (shortCode) {
        const existingShortCode = await transaction.practiceLocation.findFirst({
          where: {
            doctorProfileId: doctorProfile.id,
            lifecycleStatus: {
              not: PracticeLocationLifecycleStatus.PERMANENTLY_DELETED,
            },
            shortCode: { equals: shortCode, mode: 'insensitive' },
          },
          select: { id: true },
        });
        if (existingShortCode) {
          throw new ConflictException(
            'Another clinic already uses this short code.',
          );
        }
      }

      const [serviceTemplates, bookingQuestionTemplates] = await Promise.all([
        transaction.doctorServiceTemplate.findMany({
          where: { doctorProfileId: doctorProfile.id },
          orderBy: [{ name: 'asc' }, { id: 'asc' }],
        }),
        transaction.doctorBookingQuestionTemplate.findMany({
          where: { doctorProfileId: doctorProfile.id },
          orderBy: [{ displayOrder: 'asc' }, { id: 'asc' }],
        }),
      ]);

      const location = await transaction.practiceLocation.create({
        data: {
          doctorProfileId: doctorProfile.id,
          lifecycleStatus: PracticeLocationLifecycleStatus.DRAFT,
          name,
          shortCode,
          addressLine1,
          addressLine2: this.normalizeOptionalText(
            createPracticeLocationDto.addressLine2,
          ),
          cityMunicipality: this.normalizeOptionalText(
            createPracticeLocationDto.cityMunicipality,
          ),
          province: this.normalizeOptionalText(
            createPracticeLocationDto.province,
          ),
          postalCode: this.normalizeOptionalText(
            createPracticeLocationDto.postalCode,
          ),
          contactNumber: this.normalizeOptionalText(
            createPracticeLocationDto.contactNumber,
          ),
          clinicEmail:
            this.normalizeOptionalText(createPracticeLocationDto.clinicEmail)?.toLowerCase() ??
            null,
          clinicDescription: this.normalizeOptionalText(
            createPracticeLocationDto.clinicDescription,
          ),
          countryCode:
            this.normalizeOptionalText(createPracticeLocationDto.countryCode)?.toUpperCase() ??
            null,
          timeZone: this.normalizeOptionalText(
            createPracticeLocationDto.timeZone,
          ),
          services: {
            create: serviceTemplates.map((template) => ({
              sourceDoctorServiceTemplateId: template.id,
              name: template.name,
              description: template.description,
              durationMinutes: template.durationMinutes,
              status: template.status,
            })),
          },
          bookingQuestions: {
            create: bookingQuestionTemplates.map((template) => ({
              questionText: template.questionText,
              helpText: template.helpText,
              type: template.type,
              isRequired: template.isRequired,
              displayOrder: template.displayOrder,
              isActive: template.isActive,
              estimatedMinutesAdjustment: template.estimatedMinutesAdjustment,
              textMaximumLength: template.textMaximumLength,
              numberMinimum: template.numberMinimum,
              numberMaximum: template.numberMaximum,
              selectOptions:
                template.selectOptions === null
                  ? Prisma.JsonNull
                  : template.selectOptions,
            })),
          },
        },
        select: {
          id: true,
          doctorProfileId: true,
          publicIdentifier: true,
          lifecycleStatus: true,
          name: true,
          shortCode: true,
          addressLine1: true,
          addressLine2: true,
          cityMunicipality: true,
          province: true,
          postalCode: true,
          contactNumber: true,
          clinicEmail: true,
          clinicDescription: true,
          countryCode: true,
          timeZone: true,
          isBookingEnabled: true,
          createdAt: true,
          services: {
            orderBy: [{ name: 'asc' }, { id: 'asc' }],
            select: {
              id: true,
              sourceDoctorServiceTemplateId: true,
              name: true,
              description: true,
              durationMinutes: true,
              status: true,
            },
          },
          bookingQuestions: {
            orderBy: [{ displayOrder: 'asc' }, { id: 'asc' }],
            select: {
              id: true,
              questionText: true,
              type: true,
              isRequired: true,
              displayOrder: true,
              isActive: true,
              selectOptions: true,
            },
          },
        },
      });

      for (const template of bookingQuestionTemplates) {
        await transaction.$executeRaw(Prisma.sql`
          UPDATE "BookingQuestion"
          SET "sourceDoctorBookingQuestionTemplateId" = ${template.id}
          WHERE "practiceLocationId" = ${location.id}
            AND "displayOrder" = ${template.displayOrder}
        `);
      }

      return location;
    });
  }

  async updateOwned(
    userId: string,
    practiceLocationId: string,
    dto: UpdatePracticeLocationDto,
  ) {
    const doctorProfile = await this.prisma.doctorProfile.findUnique({
      where: { userId },
      select: { id: true },
    });

    if (!doctorProfile) {
      throw new ForbiddenException(
        'Only a doctor may update a practice location.',
      );
    }

    const existing = await this.prisma.practiceLocation.findFirst({
      where: {
        id: practiceLocationId,
        doctorProfileId: doctorProfile.id,
      },
      select: {
        id: true,
        lifecycleStatus: true,
        name: true,
        addressLine1: true,
      },
    });

    if (
      !existing ||
      existing.lifecycleStatus ===
        PracticeLocationLifecycleStatus.PERMANENTLY_DELETED
    ) {
      throw new NotFoundException('Practice location not found.');
    }

    if (existing.lifecycleStatus !== PracticeLocationLifecycleStatus.DRAFT) {
      throw new ConflictException(
        'Effective clinic configuration cannot be edited directly. Save a Doctor configuration draft instead.',
      );
    }

    const name =
      dto.name === undefined
        ? existing.name
        : this.normalizeOptionalText(dto.name);
    const addressLine1 =
      dto.addressLine1 === undefined
        ? existing.addressLine1
        : this.normalizeOptionalText(dto.addressLine1);

    return this.prisma.practiceLocation.update({
      where: { id: practiceLocationId },
      data: {
        name,
        addressLine1,
        addressLine2:
          dto.addressLine2 === undefined
            ? undefined
            : this.normalizeOptionalText(dto.addressLine2),
        cityMunicipality:
          dto.cityMunicipality === undefined
            ? undefined
            : this.normalizeOptionalText(dto.cityMunicipality),
        province:
          dto.province === undefined
            ? undefined
            : this.normalizeOptionalText(dto.province),
        postalCode:
          dto.postalCode === undefined
            ? undefined
            : this.normalizeOptionalText(dto.postalCode),
        contactNumber:
          dto.contactNumber === undefined
            ? undefined
            : this.normalizeOptionalText(dto.contactNumber),
        countryCode:
          dto.countryCode === undefined
            ? undefined
            : this.normalizeOptionalText(dto.countryCode),
        timeZone:
          dto.timeZone === undefined
            ? undefined
            : this.normalizeOptionalText(dto.timeZone),
      },
      select: {
        id: true,
        publicIdentifier: true,
        lifecycleStatus: true,
        name: true,
        shortCode: true,
        addressLine1: true,
        addressLine2: true,
        cityMunicipality: true,
        province: true,
        postalCode: true,
        contactNumber: true,
        clinicEmail: true,
        clinicDescription: true,
        countryCode: true,
        timeZone: true,
        isBookingEnabled: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  async findAllForDoctor(userId: string) {
    const doctorProfile = await this.prisma.doctorProfile.findUnique({
      where: { userId },
      select: { id: true },
    });

    if (!doctorProfile) {
      throw new ForbiddenException(
        'Only a doctor may view practice locations.',
      );
    }

    const locations = await this.prisma.practiceLocation.findMany({
      where: { doctorProfileId: doctorProfile.id },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        publicIdentifier: true,
        lifecycleStatus: true,
        name: true,
        shortCode: true,
        addressLine1: true,
        addressLine2: true,
        cityMunicipality: true,
        province: true,
        postalCode: true,
        contactNumber: true,
        clinicEmail: true,
        clinicDescription: true,
        countryCode: true,
        timeZone: true,
        isBookingEnabled: true,
        currentRegularPracticeStaffId: true,
        createdAt: true,
        updatedAt: true,
        services: {
          orderBy: [{ name: 'asc' }, { id: 'asc' }],
          select: {
            id: true,
            sourceDoctorServiceTemplateId: true,
            name: true,
            description: true,
            durationMinutes: true,
            status: true,
          },
        },
        bookingQuestions: {
          orderBy: [{ displayOrder: 'asc' }, { id: 'asc' }],
          select: {
            id: true,
            questionText: true,
            type: true,
            isRequired: true,
            displayOrder: true,
            isActive: true,
            selectOptions: true,
          },
        },
        practiceSchedules: {
          orderBy: { weekday: 'asc' },
          select: {
            weekday: true,
            isOpen: true,
            opensAtLocal: true,
            closesAtLocal: true,
            maximumOnlineBookingUntilLocal: true,
            maximumOperatingUntilLocal: true,
          },
        },
        doctorScheduleDraft: {
          select: {
            name: true,
            shortCode: true,
            addressLine1: true,
            addressLine2: true,
            cityMunicipality: true,
            province: true,
            postalCode: true,
            contactNumber: true,
            clinicEmail: true,
            clinicDescription: true,
            countryCode: true,
            timeZone: true,
            schedules: {
              orderBy: { weekday: 'asc' },
              select: {
                weekday: true,
                isOpen: true,
                opensAtLocal: true,
                closesAtLocal: true,
                maximumOnlineBookingUntilLocal: true,
                maximumOperatingUntilLocal: true,
              },
            },
            services: {
              orderBy: [{ name: 'asc' }, { id: 'asc' }],
              select: {
                id: true,
                effectiveServiceId: true,
                sourceDoctorServiceTemplateId: true,
                name: true,
                description: true,
                durationMinutes: true,
                status: true,
              },
            },
            bookingQuestions: {
              orderBy: [{ displayOrder: 'asc' }, { id: 'asc' }],
              select: {
                id: true,
                effectiveBookingQuestionId: true,
                sourceDoctorBookingQuestionTemplateId: true,
                questionText: true,
                type: true,
                isRequired: true,
                displayOrder: true,
                isActive: true,
              },
            },
          },
        },
      },
    });

    const draftQuestions = locations.flatMap(
      (location) => location.doctorScheduleDraft?.bookingQuestions ?? [],
    );
    if (!draftQuestions.length) return locations;

    const optionRows =
      await this.prisma.doctorPracticeConfigurationDraftBookingQuestionOption.findMany(
        {
          where: {
            bookingQuestionDraftId: {
              in: draftQuestions.map((question) => question.id),
            },
          },
          orderBy: [
            { bookingQuestionDraftId: 'asc' },
            { displayOrder: 'asc' },
          ],
        },
      );
    const optionsByQuestionId = new Map<
      string,
      Array<{ value: string; label: string }>
    >();
    for (const option of optionRows) {
      const current = optionsByQuestionId.get(option.bookingQuestionDraftId) ?? [];
      current.push({ value: option.optionValue, label: option.optionLabel });
      optionsByQuestionId.set(option.bookingQuestionDraftId, current);
    }

    return locations.map((location) => ({
      ...location,
      doctorScheduleDraft: location.doctorScheduleDraft
        ? {
            ...location.doctorScheduleDraft,
            bookingQuestions: location.doctorScheduleDraft.bookingQuestions.map(
              (question) => ({
                ...question,
                selectOptions:
                  question.type === BookingQuestionType.SINGLE_SELECT
                    ? optionsByQuestionId.get(question.id) ?? []
                    : null,
              }),
            ),
          }
        : null,
    }));
  }

  private normalizeOptionalText(value: string | undefined): string | null {
    const normalized = value?.trim();
    return normalized ? normalized : null;
  }
}
