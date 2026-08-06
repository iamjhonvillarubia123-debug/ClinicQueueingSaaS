import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MobileNumberService } from '../security/mobile-number/mobile-number.service';
import { CreateBookingDraftDto } from './dto/create-booking-draft.dto';
import { BookingReferenceGenerator } from './booking-reference.generator';
import { Prisma } from '../../generated/prisma/client';

@Injectable()
export class BookingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mobileNumberService: MobileNumberService,
    private readonly bookingReferenceGenerator: BookingReferenceGenerator,
  ) {}

  async createDraft(
    createBookingDraftDto: CreateBookingDraftDto,
  ) {
    const practiceLocation =
      await this.prisma.practiceLocation.findFirst({
        where: {
          id: createBookingDraftDto.practiceLocationId,
          isActive: true,
          isBookingEnabled: true,
          doctorProfile: {
            accountSettings: {
              allowOnlineBooking: true,
            },
          },
        },
        select: {
  id: true,
  name: true,
  doctorProfile: {
    select: {
      accountSettings: {
        select: {
          defaultConsultationMinutes: true,
        },
      },
    },
  },
},
      });

    if (!practiceLocation) {
      throw new NotFoundException(
        'Practice location is not available for online booking.',
      );
    }

    const accountSettings =
    practiceLocation.doctorProfile.accountSettings;

    if (!accountSettings) {
    throw new InternalServerErrorException(
    'Practice location configuration is incomplete.',
  );
}

const estimatedServiceMinutes =
  accountSettings.defaultConsultationMinutes;

    const protectedMobileNumber =
    this.mobileNumberService.protect(
    createBookingDraftDto.mobileNumber,
    );

    const expiresAt = new Date(
  Date.now() + 30 * 60 * 1000,
);

const maximumReferenceAttempts = 3;

for (
  let attempt = 1;
  attempt <= maximumReferenceAttempts;
  attempt += 1
) {
  const bookingReference =
    this.bookingReferenceGenerator.generate();

  try {
    return await this.prisma.bookingDraft.create({
      data: {
        bookingReference,
        practiceLocationId:
          createBookingDraftDto.practiceLocationId,
        existingPatientResponse:
          createBookingDraftDto.existingPatientResponse,
        firstName:
          createBookingDraftDto.firstName.trim(),
        middleName:
          createBookingDraftDto.middleName?.trim() || null,
        lastName:
          createBookingDraftDto.lastName.trim(),
        suffix:
          createBookingDraftDto.suffix?.trim() || null,
        mobileNumberEncrypted:
          protectedMobileNumber.encrypted,
        mobileNumberHash:
          protectedMobileNumber.hash,
        mobileNumberLastFour:
          protectedMobileNumber.lastFour,
        serviceDate: new Date(
          `${createBookingDraftDto.serviceDate}T00:00:00.000Z`,
        ),
        estimatedServiceMinutes,
        expiresAt,
      },
      select: {
        id: true,
        bookingReference: true,
        status: true,
        practiceLocationId: true,
        existingPatientResponse: true,
        serviceDate: true,
        estimatedServiceMinutes: true,
        expiresAt: true,
        createdAt: true,
      },
    });
  } catch (error) {
    const isUniqueConflict =
      error instanceof
        Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002';

    if (isUniqueConflict) {
      continue;
    }

    throw error;
  }
}

throw new InternalServerErrorException(
  'Unable to generate a unique booking reference.',
);
  }
}