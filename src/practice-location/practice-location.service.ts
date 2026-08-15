import { ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { PracticeLocationLifecycleStatus } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePracticeLocationDto } from './dto/create-practice-location.dto';

@Injectable()
export class PracticeLocationService {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    userId: string,
    createPracticeLocationDto: CreatePracticeLocationDto,
  ) {
    const doctorProfile = await this.prisma.doctorProfile.findUnique({
      where: {
        userId,
      },
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

    if (name && addressLine1) {
      const existingLocation = await this.prisma.practiceLocation.findFirst({
        where: {
          doctorProfileId: doctorProfile.id,
          lifecycleStatus: PracticeLocationLifecycleStatus.ACTIVE,
          name: {
            equals: name,
            mode: 'insensitive',
          },
          addressLine1: {
            equals: addressLine1,
            mode: 'insensitive',
          },
        },
      });

      if (existingLocation) {
        throw new ConflictException(
          'An active practice location with this name and address already exists.',
        );
      }
    }

    return this.prisma.practiceLocation.create({
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
        province: this.normalizeOptionalText(createPracticeLocationDto.province),
        postalCode: this.normalizeOptionalText(
          createPracticeLocationDto.postalCode,
        ),
        contactNumber: this.normalizeOptionalText(
          createPracticeLocationDto.contactNumber,
        ),
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
  }

  async findAllForDoctor(userId: string) {
    const doctorProfile = await this.prisma.doctorProfile.findUnique({
      where: {
        userId,
      },
    });

    if (!doctorProfile) {
      throw new ForbiddenException(
        'Only a doctor may view practice locations.',
      );
    }

    return this.prisma.practiceLocation.findMany({
      where: {
        doctorProfileId: doctorProfile.id,
      },
      orderBy: {
        createdAt: 'asc',
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
