import { BadRequestException } from '@nestjs/common';
import {
  BookingDraftMode,
  BookingDraftStatus,
} from '../../generated/prisma/client';
import { OtpService } from '../otp/otp.service';
import { PrismaService } from '../prisma/prisma.service';
import { MobileNumberService } from '../security/mobile-number/mobile-number.service';
import { BookingAnswerValidationService } from './booking-answer-validation.service';
import { BookingConfigurationService } from './booking-configuration.service';
import { BookingDraftControlService } from './booking-draft-control.service';
import { BookingDraftEditService } from './booking-draft-edit.service';

describe('BookingDraftEditService', () => {
  const transactionMock = {
    bookingDraft: {
      findUniqueOrThrow: jest.fn(),
      update: jest.fn(),
    },
    bookingDraftAnswer: { deleteMany: jest.fn(), createMany: jest.fn() },
    bookingDraftServiceSelection: {
      deleteMany: jest.fn(),
      createMany: jest.fn(),
    },
    bookingDraftMember: { deleteMany: jest.fn(), create: jest.fn() },
    otpVerification: { updateMany: jest.fn() },
    bookingQuestion: { findMany: jest.fn() },
    practiceLocationService: { findMany: jest.fn() },
  };
  const prismaMock = {
    practiceLocation: { findUnique: jest.fn() },
    $transaction: jest.fn(),
  };
  const mobileNumberServiceMock = { protect: jest.fn() };
  const configurationMock = { validateSelectedServices: jest.fn() };
  const answerValidationMock = {
    loadActiveQuestions: jest.fn(),
    prepareAnswers: jest.fn(),
    requiredAnswersComplete: jest.fn(),
  };
  const controlMock = { requireEditableDraftForUpdate: jest.fn() };
  const otpMock = { createBookingOtpInTransaction: jest.fn() };

  let service: BookingDraftEditService;

  beforeEach(() => {
    jest.clearAllMocks();
    prismaMock.$transaction.mockImplementation(
      (callback: (transaction: typeof transactionMock) => Promise<unknown>) =>
        callback(transactionMock),
    );
    prismaMock.practiceLocation.findUnique.mockResolvedValue({
      doctorProfile: {
        accountSettings: { maximumEstimatedServiceMinutesPerPatient: null },
      },
    });
    mobileNumberServiceMock.protect.mockReturnValue({
      encrypted: 'encrypted-mobile',
      hash: 'mobile-hash',
      lastFour: '4567',
    });
    configurationMock.validateSelectedServices.mockResolvedValue([
      { id: 'service-1', name: 'Consultation', durationMinutes: 30 },
    ]);
    answerValidationMock.loadActiveQuestions.mockResolvedValue([]);
    answerValidationMock.prepareAnswers.mockReturnValue([]);
    answerValidationMock.requiredAnswersComplete.mockReturnValue(true);
    controlMock.requireEditableDraftForUpdate.mockResolvedValue({
      id: 'draft-1',
      mode: BookingDraftMode.INDIVIDUAL,
      status: BookingDraftStatus.PENDING_OTP,
      practiceLocationId: 'location-1',
      serviceDate: new Date('2026-08-17T00:00:00.000Z'),
      expiresAt: new Date('2026-08-17T14:00:00.000Z'),
      consumedAt: null,
      cancelledAt: null,
      draftControlTokenHash: 'a'.repeat(64),
    });

    service = new BookingDraftEditService(
      prismaMock as unknown as PrismaService,
      mobileNumberServiceMock as unknown as MobileNumberService,
      configurationMock as unknown as BookingConfigurationService,
      answerValidationMock as unknown as BookingAnswerValidationService,
      controlMock as unknown as BookingDraftControlService,
      otpMock as unknown as OtpService,
    );
  });

  it('does not invalidate OTP for an identical full-draft autosave', async () => {
    transactionMock.bookingDraft.findUniqueOrThrow.mockResolvedValue({
      id: 'draft-1',
      mode: BookingDraftMode.INDIVIDUAL,
      practiceLocationId: 'location-1',
      firstName: 'Maria',
      middleName: null,
      lastName: 'Reyes',
      suffix: null,
      existingPatientResponse: 'NO',
      mobileNumberHash: 'mobile-hash',
      serviceDate: new Date('2026-08-17T00:00:00.000Z'),
      serviceSelections: [{ practiceLocationServiceId: 'service-1' }],
      bookingDraftAnswers: [],
      bookingDraftMembers: [],
    });

    const result = await service.replaceDraft('draft-1', {
      practiceLocationId: 'location-1',
      mode: 'INDIVIDUAL',
      firstName: 'Maria',
      lastName: 'Reyes',
      existingPatientResponse: 'NO',
      mobileNumber: '+639171234567',
      serviceDate: '2026-08-17',
      selectedServiceIds: ['service-1'],
      draftControlToken: 'browser-secret',
    });

    expect(result.materialChanged).toBe(false);
    expect(transactionMock.otpVerification.updateMany).not.toHaveBeenCalled();
    expect(transactionMock.bookingDraft.update).not.toHaveBeenCalled();
  });

  it('invalidates active booking OTPs and replaces material draft data atomically', async () => {
    transactionMock.bookingDraft.findUniqueOrThrow.mockResolvedValue({
      id: 'draft-1',
      mode: BookingDraftMode.INDIVIDUAL,
      practiceLocationId: 'location-1',
      firstName: 'Maria',
      middleName: null,
      lastName: 'Reyes',
      suffix: null,
      existingPatientResponse: 'NO',
      mobileNumberHash: 'mobile-hash',
      serviceDate: new Date('2026-08-17T00:00:00.000Z'),
      serviceSelections: [{ practiceLocationServiceId: 'service-1' }],
      bookingDraftAnswers: [],
      bookingDraftMembers: [],
    });
    transactionMock.otpVerification.updateMany.mockResolvedValue({ count: 1 });
    transactionMock.bookingDraftAnswer.deleteMany.mockResolvedValue({
      count: 0,
    });
    transactionMock.bookingDraftServiceSelection.deleteMany.mockResolvedValue({
      count: 1,
    });
    transactionMock.bookingDraft.update.mockResolvedValue({ id: 'draft-1' });

    const result = await service.replaceDraft('draft-1', {
      practiceLocationId: 'location-1',
      mode: 'INDIVIDUAL',
      firstName: 'Maria Updated',
      lastName: 'Reyes',
      existingPatientResponse: 'NO',
      mobileNumber: '+639171234567',
      serviceDate: '2026-08-18',
      selectedServiceIds: ['service-1'],
      draftControlToken: 'browser-secret',
    });

    expect(result.materialChanged).toBe(true);
    expect(result.otpInvalidated).toBe(true);
    expect(transactionMock.otpVerification.updateMany).toHaveBeenCalledTimes(1);
    expect(transactionMock.bookingDraft.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          firstName: 'Maria Updated',
          serviceDate: new Date('2026-08-18T00:00:00.000Z'),
        }) as unknown,
      }),
    );
  });

  it('refuses OTP request for a one-member multi-person construction state', async () => {
    controlMock.requireEditableDraftForUpdate.mockResolvedValue({
      id: 'draft-group',
      mode: BookingDraftMode.MULTI_PERSON,
      status: BookingDraftStatus.PENDING_OTP,
      practiceLocationId: 'location-1',
      serviceDate: new Date('2026-08-17T00:00:00.000Z'),
      expiresAt: new Date('2026-08-17T14:00:00.000Z'),
      consumedAt: null,
      cancelledAt: null,
      draftControlTokenHash: 'a'.repeat(64),
    });
    transactionMock.bookingDraft.findUniqueOrThrow.mockResolvedValue({
      id: 'draft-group',
      mode: BookingDraftMode.MULTI_PERSON,
      practiceLocationId: 'location-1',
      serviceSelections: [],
      bookingDraftAnswers: [],
      bookingDraftMembers: [
        {
          id: 'member-1',
          serviceSelections: [{ practiceLocationServiceId: 'service-1' }],
          answers: [],
        },
      ],
      otpVerifications: [],
    });
    transactionMock.bookingQuestion.findMany.mockResolvedValue([]);

    await expect(
      service.requestBookingOtp('draft-group', {
        draftControlToken: 'browser-secret',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(otpMock.createBookingOtpInTransaction).not.toHaveBeenCalled();
  });
});
