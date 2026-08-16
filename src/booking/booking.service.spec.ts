import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '../../generated/prisma/client';
import { OtpService } from '../otp/otp.service';
import { PrismaService } from '../prisma/prisma.service';
import { MobileNumberService } from '../security/mobile-number/mobile-number.service';
import { BookingConfigurationService } from './booking-configuration.service';
import { BookingReferenceGenerator } from './booking-reference.generator';
import { BookingService } from './booking.service';

describe('BookingService', () => {
  let service: BookingService;

  const transactionMock = {
    bookingDraft: { create: jest.fn() },
    bookingDraftMember: { create: jest.fn() },
    bookingDraftServiceSelection: { createMany: jest.fn() },
  };
  const prismaServiceMock = {
    practiceLocation: { findFirst: jest.fn() },
    bookingDraft: { create: jest.fn() },
    $transaction: jest.fn(),
  };
  const bookingConfigurationServiceMock = {
    validateSelectedServices: jest.fn(),
  };
  const otpServiceMock = {
    createBookingOtp: jest.fn(),
    verifyBookingOtp: jest.fn(),
  };
  const mobileNumberServiceMock = { protect: jest.fn() };
  const bookingReferenceGeneratorMock = { generate: jest.fn() };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BookingService,
        { provide: PrismaService, useValue: prismaServiceMock },
        { provide: MobileNumberService, useValue: mobileNumberServiceMock },
        {
          provide: BookingReferenceGenerator,
          useValue: bookingReferenceGeneratorMock,
        },
        { provide: OtpService, useValue: otpServiceMock },
        {
          provide: BookingConfigurationService,
          useValue: bookingConfigurationServiceMock,
        },
      ],
    }).compile();

    service = module.get<BookingService>(BookingService);
    jest.clearAllMocks();
    prismaServiceMock.$transaction.mockImplementation(
      (callback: (transaction: typeof transactionMock) => Promise<unknown>) =>
        callback(transactionMock),
    );
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('persists individual selected Services and applies the Doctor per-patient cap', async () => {
    prismaServiceMock.practiceLocation.findFirst.mockResolvedValue({
      id: 'practice-1',
      name: 'Clinic',
      doctorProfile: {
        accountSettings: { maximumEstimatedServiceMinutesPerPatient: 45 },
      },
    });
    bookingConfigurationServiceMock.validateSelectedServices.mockResolvedValue([
      { id: 'service-a', name: 'A', durationMinutes: 20 },
      { id: 'service-b', name: 'B', durationMinutes: 40 },
    ]);
    mobileNumberServiceMock.protect.mockReturnValue({
      encrypted: 'encrypted-mobile',
      hash: 'mobile-hash',
      lastFour: '4567',
    });
    bookingReferenceGeneratorMock.generate.mockReturnValue('CQ-ONE');
    prismaServiceMock.bookingDraft.create.mockResolvedValue({
      id: 'draft-1',
      bookingReference: 'CQ-ONE',
      mode: 'INDIVIDUAL',
      status: 'PENDING_OTP',
      practiceLocationId: 'practice-1',
      existingPatientResponse: 'UNSURE',
      serviceDate: new Date('2026-08-10'),
      estimatedServiceMinutes: 45,
      expiresAt: new Date(),
      createdAt: new Date(),
    });
    otpServiceMock.createBookingOtp.mockResolvedValue({
      otpVerification: { id: 'otp-1', expiresAt: new Date(), maxAttempts: 5 },
    });

    await service.createDraft({
      practiceLocationId: 'practice-1',
      mode: 'INDIVIDUAL',
      firstName: 'Maria',
      middleName: 'Santos',
      lastName: 'Reyes',
      suffix: 'Jr.',
      existingPatientResponse: 'UNSURE',
      mobileNumber: '+639171234567',
      serviceDate: '2026-08-10',
      selectedServiceIds: ['service-a', 'service-b'],
    });

    expect(prismaServiceMock.bookingDraft.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          mode: 'INDIVIDUAL',
          estimatedServiceMinutes: 45,
          serviceSelections: {
            create: [
              { practiceLocationServiceId: 'service-a' },
              { practiceLocationServiceId: 'service-b' },
            ],
          },
        }) as unknown,
      }),
    );
  });

  it('creates a multi-person parent with member-specific identity, Services, and capped duration', async () => {
    prismaServiceMock.practiceLocation.findFirst.mockResolvedValue({
      id: 'practice-1',
      name: 'Clinic',
      doctorProfile: {
        accountSettings: { maximumEstimatedServiceMinutesPerPatient: 45 },
      },
    });
    bookingConfigurationServiceMock.validateSelectedServices
      .mockResolvedValueOnce([
        { id: 'service-a', name: 'A', durationMinutes: 20 },
        { id: 'service-b', name: 'B', durationMinutes: 40 },
      ])
      .mockResolvedValueOnce([
        { id: 'service-c', name: 'C', durationMinutes: 30 },
      ]);
    mobileNumberServiceMock.protect.mockReturnValue({
      encrypted: 'encrypted-controller-mobile',
      hash: 'controller-mobile-hash',
      lastFour: '4567',
    });
    bookingReferenceGeneratorMock.generate.mockReturnValue('CQ-GROUP');
    transactionMock.bookingDraft.create.mockResolvedValue({
      id: 'draft-group',
      bookingReference: 'CQ-GROUP',
      mode: 'MULTI_PERSON',
      status: 'PENDING_OTP',
      practiceLocationId: 'practice-1',
      existingPatientResponse: null,
      serviceDate: new Date('2026-08-10'),
      estimatedServiceMinutes: null,
      expiresAt: new Date(),
      createdAt: new Date(),
    });
    transactionMock.bookingDraftMember.create
      .mockResolvedValueOnce({ id: 'member-1' })
      .mockResolvedValueOnce({ id: 'member-2' });
    transactionMock.bookingDraftServiceSelection.createMany.mockResolvedValue({
      count: 1,
    });
    otpServiceMock.createBookingOtp.mockResolvedValue({
      otpVerification: { id: 'otp-group', expiresAt: new Date() },
    });

    const result = await service.createDraft({
      practiceLocationId: 'practice-1',
      mode: 'MULTI_PERSON',
      mobileNumber: '+639171234567',
      serviceDate: '2026-08-10',
      members: [
        {
          firstName: 'Ana',
          lastName: 'Reyes',
          existingPatientResponse: 'YES',
          selectedServiceIds: ['service-a', 'service-b'],
        },
        {
          firstName: 'Ben',
          lastName: 'Reyes',
          existingPatientResponse: 'NO',
          selectedServiceIds: ['service-c'],
        },
      ],
    });

    expect(transactionMock.bookingDraft.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          mode: 'MULTI_PERSON',
          firstName: null,
          lastName: null,
          existingPatientResponse: null,
          estimatedServiceMinutes: null,
          mobileNumberHash: 'controller-mobile-hash',
        }) as unknown,
      }),
    );
    expect(transactionMock.bookingDraftMember.create).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        data: expect.objectContaining({
          bookingDraftId: 'draft-group',
          memberOrder: 1,
          firstName: 'Ana',
          estimatedServiceMinutes: 45,
        }) as unknown,
      }),
    );
    expect(transactionMock.bookingDraftMember.create).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        data: expect.objectContaining({
          bookingDraftId: 'draft-group',
          memberOrder: 2,
          firstName: 'Ben',
          estimatedServiceMinutes: 30,
        }) as unknown,
      }),
    );
    expect(
      transactionMock.bookingDraftServiceSelection.createMany,
    ).toHaveBeenNthCalledWith(1, {
      data: [
        {
          bookingDraftId: 'draft-group',
          bookingDraftMemberId: 'member-1',
          practiceLocationServiceId: 'service-a',
        },
        {
          bookingDraftId: 'draft-group',
          bookingDraftMemberId: 'member-1',
          practiceLocationServiceId: 'service-b',
        },
      ],
    });
    expect(otpServiceMock.createBookingOtp).toHaveBeenCalledWith('draft-group');
    expect(result.bookingDraft.mode).toBe('MULTI_PERSON');
  });

  it('uses the full individual Service-duration sum when the Doctor cap is unset', async () => {
    prismaServiceMock.practiceLocation.findFirst.mockResolvedValue({
      id: 'practice-1',
      name: 'Clinic',
      doctorProfile: {
        accountSettings: { maximumEstimatedServiceMinutesPerPatient: null },
      },
    });
    bookingConfigurationServiceMock.validateSelectedServices.mockResolvedValue([
      { id: 'service-a', name: 'A', durationMinutes: 20 },
      { id: 'service-b', name: 'B', durationMinutes: 40 },
    ]);
    mobileNumberServiceMock.protect.mockReturnValue({
      encrypted: 'encrypted-mobile',
      hash: 'mobile-hash',
      lastFour: '4567',
    });
    bookingReferenceGeneratorMock.generate.mockReturnValue('CQ-SUM');
    prismaServiceMock.bookingDraft.create.mockResolvedValue({
      id: 'draft-1',
      bookingReference: 'CQ-SUM',
      mode: 'INDIVIDUAL',
      status: 'PENDING_OTP',
      practiceLocationId: 'practice-1',
      existingPatientResponse: 'NO',
      serviceDate: new Date('2026-08-10'),
      estimatedServiceMinutes: 60,
      expiresAt: new Date(),
      createdAt: new Date(),
    });
    otpServiceMock.createBookingOtp.mockResolvedValue({
      otpVerification: { id: 'otp-1', expiresAt: new Date(), maxAttempts: 5 },
    });

    await service.createDraft({
      practiceLocationId: 'practice-1',
      mode: 'INDIVIDUAL',
      firstName: 'Maria',
      lastName: 'Reyes',
      existingPatientResponse: 'NO',
      mobileNumber: '+639171234567',
      serviceDate: '2026-08-10',
      selectedServiceIds: ['service-a', 'service-b'],
    });

    expect(prismaServiceMock.bookingDraft.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ estimatedServiceMinutes: 60 }) as unknown,
      }),
    );
  });

  it('should retry when an individual booking reference already exists', async () => {
    prismaServiceMock.practiceLocation.findFirst.mockResolvedValue({
      id: 'practice-1',
      name: 'Clinic',
      doctorProfile: {
        accountSettings: { maximumEstimatedServiceMinutesPerPatient: null },
      },
    });
    bookingConfigurationServiceMock.validateSelectedServices.mockResolvedValue([
      { id: 'service-a', name: 'A', durationMinutes: 30 },
    ]);
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
      { code: 'P2002', clientVersion: 'test' },
    );
    prismaServiceMock.bookingDraft.create
      .mockRejectedValueOnce(uniqueError)
      .mockResolvedValueOnce({
        id: 'draft-1',
        bookingReference: 'CQ-SECOND',
        mode: 'INDIVIDUAL',
        status: 'PENDING_OTP',
        practiceLocationId: 'practice-1',
        existingPatientResponse: 'UNSURE',
        serviceDate: new Date('2026-08-10'),
        estimatedServiceMinutes: 30,
        expiresAt: new Date(),
        createdAt: new Date(),
      });
    otpServiceMock.createBookingOtp.mockResolvedValue({
      otpVerification: { id: 'otp-1', expiresAt: new Date(), maxAttempts: 5 },
    });

    const result = await service.createDraft({
      practiceLocationId: 'practice-1',
      mode: 'INDIVIDUAL',
      firstName: 'Maria',
      lastName: 'Reyes',
      existingPatientResponse: 'UNSURE',
      mobileNumber: '+639171234567',
      serviceDate: '2026-08-10',
      selectedServiceIds: ['service-a'],
    });

    expect(bookingReferenceGeneratorMock.generate).toHaveBeenCalledTimes(2);
    expect(result.bookingDraft.bookingReference).toBe('CQ-SECOND');
  });

  it('should delegate booking OTP verification to OtpService', async () => {
    otpServiceMock.verifyBookingOtp.mockResolvedValue({
      message: 'OTP verified successfully.',
      otpVerification: {
        id: 'otp-1',
        bookingDraftId: 'draft-1',
        purpose: 'BOOKING_VERIFICATION',
        verifiedAt: new Date('2026-08-06T05:00:00.000Z'),
      },
    });

    const result = await service.verifyBookingOtp({
      bookingDraftId: 'draft-1',
      otp: '123456',
    });

    expect(otpServiceMock.verifyBookingOtp).toHaveBeenCalledWith(
      'draft-1',
      '123456',
    );
    expect(result.otpVerification.id).toBe('otp-1');
  });
});
