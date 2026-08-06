import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { MobileNumberService } from '../security/mobile-number/mobile-number.service';
import { BookingReferenceGenerator } from './booking-reference.generator';
import { BookingService } from './booking.service';
import { Prisma } from '../../generated/prisma/client';

describe('BookingService', () => {
  let service: BookingService;

  const prismaServiceMock = {
    practiceLocation: {
      findFirst: jest.fn(),
    },
    bookingDraft: {
      create: jest.fn(),
    },
  };

  const mobileNumberServiceMock = {
    protect: jest.fn(),
  };

  const bookingReferenceGeneratorMock = {
    generate: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BookingService,
        {
          provide: PrismaService,
          useValue: prismaServiceMock,
        },
        {
          provide: MobileNumberService,
          useValue: mobileNumberServiceMock,
        },
        {
          provide: BookingReferenceGenerator,
          useValue: bookingReferenceGeneratorMock,
        },
      ],
    }).compile();

    service = module.get<BookingService>(BookingService);

    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should retry when booking reference already exists', async () => {
  const dto = {
    practiceLocationId: 'practice-1',
    firstName: 'Maria',
    middleName: 'Santos',
    lastName: 'Reyes',
    suffix: 'Jr.',
    existingPatientResponse: 'UNSURE',
    mobileNumber: '+639171234567',
    serviceDate: '2026-08-10',
  };

  prismaServiceMock.practiceLocation.findFirst.mockResolvedValue({
    id: 'practice-1',
    name: 'Clinic',
    doctorProfile: {
      accountSettings: {
        defaultConsultationMinutes: 30,
      },
    },
  });

  mobileNumberServiceMock.protect.mockReturnValue({
    encrypted: 'encrypted-mobile',
    hash: 'mobile-hash',
    lastFour: '4567',
  });

  bookingReferenceGeneratorMock.generate
    .mockReturnValueOnce('CQ-FIRST')
    .mockReturnValueOnce('CQ-SECOND');

  const uniqueError = new Prisma.PrismaClientKnownRequestError(
    'Unique constraint failed',
    {
      code: 'P2002',
      clientVersion: 'test',
    },
  );

  prismaServiceMock.bookingDraft.create
    .mockRejectedValueOnce(uniqueError)
    .mockResolvedValueOnce({
      id: 'draft-1',
      bookingReference: 'CQ-SECOND',
      status: 'PENDING_OTP',
      practiceLocationId: 'practice-1',
      existingPatientResponse: 'UNSURE',
      serviceDate: new Date('2026-08-10'),
      estimatedServiceMinutes: 30,
      expiresAt: new Date(),
      createdAt: new Date(),
    });

  const result = await service.createDraft(dto);

  expect(
    bookingReferenceGeneratorMock.generate,
  ).toHaveBeenCalledTimes(2);

  expect(
    prismaServiceMock.bookingDraft.create,
  ).toHaveBeenCalledTimes(2);

  expect(result.bookingReference).toBe('CQ-SECOND');
  });
});