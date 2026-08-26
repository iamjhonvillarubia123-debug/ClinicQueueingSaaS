import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
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
          services: {
            create: serviceTemplates.map((template) => ({
              sourceDoctorServiceTemplateId: template.id,
              name: template.name,
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
          addressLine1: true,
          addressLine2: true,
          cityMunicipality: true,
          province: true,
          postalCode: true,
          contactNumber: true,
          countryCode: true,
          timeZone: true,
          isBookingEnabled: true,
          createdAt: true,
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

    if (!existing || existing.lifecycleStatus === PracticeLocationLifecycleStatus.PERMANENTLY_DELETED) {
      throw new NotFoundException('Practice location not found.');
    }

    const name = dto.name === undefined ? existing.name : this.normalizeOptionalText(dto.name);
    const addressLine1 = dto.addressLine1 === undefined
      ? existing.addressLine1
      : this.normalizeOptionalText(dto.addressLine1);

    if (
      existing.lifecycleStatus === PracticeLocationLifecycleStatus.ACTIVE &&
      name &&
      addressLine1
    ) {
      const duplicate = await this.prisma.practiceLocation.findFirst({
        where: {
          doctorProfileId: doctorProfile.id,
          lifecycleStatus: PracticeLocationLifecycleStatus.ACTIVE,
          id: { not: practiceLocationId },
          name: { equals: name, mode: 'insensitive' },
          addressLine1: { equals: addressLine1, mode: 'insensitive' },
        },
        select: { id: true },
      });

      if (duplicate) {
        throw new ConflictException(
          'An active practice location with this name and address already exists.',
        );
      }
    }

    return this.prisma.practiceLocation.update({
      where: { id: practiceLocationId },
      data: {
        name,
        addressLine1,
        addressLine2: dto.addressLine2 === undefined ? undefined : this.normalizeOptionalText(dto.addressLine2),
        cityMunicipality: dto.cityMunicipality === undefined ? undefined : this.normalizeOptionalText(dto.cityMunicipality),
        province: dto.province === undefined ? undefined : this.normalizeOptionalText(dto.province),
        postalCode: dto.postalCode === undefined ? undefined : this.normalizeOptionalText(dto.postalCode),
        contactNumber: dto.contactNumber === undefined ? undefined : this.normalizeOptionalText(dto.contactNumber),
        countryCode: dto.countryCode === undefined ? undefined : this.normalizeOptionalText(dto.countryCode),
        timeZone: dto.timeZone === undefined ? undefined : this.normalizeOptionalText(dto.timeZone),
      },
      select: {
        id: true,
        publicIdentifier: true,
        lifecycleStatus: true,
        name: true,
        addressLine1: true,
        addressLine2: true,
        cityMunicipality: true,
        province: true,
        postalCode: true,
        contactNumber: true,
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
    });

    if (!doctorProfile) {
      throw new ForbiddenException(
        'Only a doctor may view practice locations.',
      );
    }

    return this.prisma.practiceLocation.findMany({
      where: { doctorProfileId: doctorProfile.id },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        publicIdentifier: true,
        lifecycleStatus: true,
        name: true,
        addressLine1: true,
        addressLine2: true,
        cityMunicipality: true,
        province: true,
        postalCode: true,
        contactNumber: true,
        countryCode: true,
        timeZone: true,
        isBookingEnabled: true,
        currentRegularPracticeStaffId: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  private normalizeOptionalText(value: string | undefined): string | null {
    const normalized = value?.trim();
    return normalized ? normalized : null;
  }
}
