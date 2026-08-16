import { createHash } from 'crypto';
import { ConflictException, ForbiddenException } from '@nestjs/common';
import {
  AdministrativeRestrictionStatus,
  BookingQuestionType,
  PracticeLocationLifecycleStatus,
  SecretarySettingsDraftStatus,
  ServiceAvailabilityStatus,
  UserAccountStatus,
  UserRole,
  Weekday,
} from '../../generated/prisma/client';
import { SecretarySettingsDraftApprovalService } from './secretary-settings-draft-approval.service';

describe('SecretarySettingsDraftApprovalService', () => {
  const scheduleResolutionMock = {
    resolveConfiguredSchedule: jest.fn(),
  };
  const doctorCalendarMock = { isAvailableForInterval: jest.fn() };
  const crossLocationConflictMock = { assertNoConflictForInterval: jest.fn() };
  const prismaServiceMock = {
    $transaction: jest.fn(),
    $queryRaw: jest.fn(),
    $executeRaw: jest.fn(),
    user: { findUnique: jest.fn() },
    commandIdempotency: { findUnique: jest.fn(), create: jest.fn() },
    secretarySettingsDraft: { update: jest.fn() },
    secretarySettingsDraftService: { findMany: jest.fn() },
    secretarySettingsDraftPracticeSchedule: { findMany: jest.fn() },
    secretarySettingsDraftScheduleException: { findMany: jest.fn() },
    secretarySettingsDraftBookingQuestion: { findMany: jest.fn() },
    practiceLocationService: {
      findMany: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
    },
    practiceSchedule: { upsert: jest.fn(), findMany: jest.fn() },
    scheduleException: { upsert: jest.fn() },
    bookingQuestion: {
      findMany: jest.fn(),
      aggregate: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
    },
  };
  let service: SecretarySettingsDraftApprovalService;
  let capturedApprovalUpdate: unknown;

  const lockedDraft = {
    id: 'draft-1',
    practiceLocationId: 'location-1',
    status: SecretarySettingsDraftStatus.SUBMITTED,
    lifecycleStatus: PracticeLocationLifecycleStatus.DISABLED,
    doctorProfileId: 'doctor-profile-1',
    doctorUserId: 'doctor-1',
    timeZone: 'Asia/Manila',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    capturedApprovalUpdate = undefined;
    service = new SecretarySettingsDraftApprovalService(
      prismaServiceMock as never,
      scheduleResolutionMock as never,
      doctorCalendarMock as never,
      crossLocationConflictMock as never,
    );
    prismaServiceMock.$transaction.mockImplementation(
      (callback: (transaction: typeof prismaServiceMock) => unknown) =>
        callback(prismaServiceMock),
    );
    prismaServiceMock.$queryRaw
      .mockResolvedValueOnce([lockedDraft])
      .mockResolvedValueOnce([{ id: 'doctor-1' }]);
    prismaServiceMock.$executeRaw.mockResolvedValue(1);
    prismaServiceMock.user.findUnique.mockResolvedValue({
      role: UserRole.DOCTOR,
      accountStatus: UserAccountStatus.ACTIVE,
      administrativeRestrictionStatus: AdministrativeRestrictionStatus.NONE,
    });
    prismaServiceMock.commandIdempotency.findUnique.mockResolvedValue(null);
    prismaServiceMock.secretarySettingsDraft.update.mockImplementation(
      (value: unknown) => {
        capturedApprovalUpdate = value;
        return Promise.resolve(undefined);
      },
    );
    prismaServiceMock.secretarySettingsDraftService.findMany.mockResolvedValue(
      [],
    );
    prismaServiceMock.secretarySettingsDraftPracticeSchedule.findMany.mockResolvedValue(
      [],
    );
    prismaServiceMock.secretarySettingsDraftScheduleException.findMany.mockResolvedValue(
      [],
    );
    prismaServiceMock.secretarySettingsDraftBookingQuestion.findMany.mockResolvedValue(
      [],
    );
    prismaServiceMock.practiceLocationService.findMany.mockResolvedValue([]);
    prismaServiceMock.bookingQuestion.findMany.mockResolvedValue([]);
    prismaServiceMock.bookingQuestion.aggregate.mockResolvedValue({
      _max: { displayOrder: null },
    });
  });

  it('atomically applies all proposal families and marks the submitted draft approved', async () => {
    const serviceProposal = {
      id: 'service-proposal-1',
      secretarySettingsDraftId: 'draft-1',
      practiceLocationServiceId: 'service-1',
      sourceDoctorServiceTemplateId: null,
      proposedName: 'Consultation',
      proposedDurationMinutes: 30,
      proposedStatus: ServiceAvailabilityStatus.ACTIVE,
    };
    const scheduleProposal = {
      id: 'schedule-proposal-1',
      secretarySettingsDraftId: 'draft-1',
      weekday: Weekday.MONDAY,
      proposedIsOpen: true,
      proposedOpensAtLocal: new Date('1970-01-01T01:00:00.000Z'),
      proposedClosesAtLocal: new Date('1970-01-01T09:00:00.000Z'),
      proposedMaximumOnlineBookingUntilLocal: null,
      proposedMaximumOperatingUntilLocal: null,
    };
    const exceptionProposal = {
      id: 'exception-proposal-1',
      secretarySettingsDraftId: 'draft-1',
      serviceDate: new Date('2026-08-20T00:00:00.000Z'),
      proposedIsOpen: false,
      proposedOpensAtLocal: null,
      proposedClosesAtLocal: null,
      proposedMaximumOnlineBookingUntilLocal: null,
      proposedMaximumOperatingUntilLocal: null,
    };
    const questionProposal = {
      id: 'question-proposal-1',
      secretarySettingsDraftId: 'draft-1',
      bookingQuestionId: 'question-1',
      sourceDoctorBookingQuestionTemplateId: null,
      proposedQuestionText: 'Existing patient?',
      proposedHelpText: null,
      proposedType: BookingQuestionType.BOOLEAN,
      proposedIsRequired: true,
      proposedDisplayOrder: 0,
      proposedIsActive: true,
      proposedEstimatedMinutesAdjustment: 0,
      proposedTextMaximumLength: null,
      proposedNumberMinimum: null,
      proposedNumberMaximum: null,
      proposedSelectOptions: null,
    };
    prismaServiceMock.secretarySettingsDraftService.findMany.mockResolvedValue([
      serviceProposal,
    ]);
    prismaServiceMock.secretarySettingsDraftPracticeSchedule.findMany.mockResolvedValue(
      [scheduleProposal],
    );
    prismaServiceMock.secretarySettingsDraftScheduleException.findMany.mockResolvedValue(
      [exceptionProposal],
    );
    prismaServiceMock.secretarySettingsDraftBookingQuestion.findMany.mockResolvedValue(
      [questionProposal],
    );
    prismaServiceMock.practiceLocationService.findMany.mockResolvedValue([
      { id: 'service-1' },
    ]);
    prismaServiceMock.bookingQuestion.findMany.mockResolvedValue([
      { id: 'question-1', displayOrder: 0, isActive: true },
    ]);
    prismaServiceMock.bookingQuestion.aggregate.mockResolvedValue({
      _max: { displayOrder: 0 },
    });

    await expect(
      service.approve('doctor-1', 'draft-1', 'approve-key'),
    ).resolves.toEqual({
      approved: true,
      replayed: false,
      draftId: 'draft-1',
      status: SecretarySettingsDraftStatus.APPROVED,
    });

    expect(prismaServiceMock.practiceLocationService.update).toHaveBeenCalled();
    expect(prismaServiceMock.practiceSchedule.upsert).toHaveBeenCalled();
    expect(prismaServiceMock.scheduleException.upsert).toHaveBeenCalled();
    expect(prismaServiceMock.bookingQuestion.update).toHaveBeenCalled();
    expect(
      prismaServiceMock.secretarySettingsDraft.update,
    ).toHaveBeenCalledTimes(1);
    expect(capturedApprovalUpdate).toEqual({
      where: { id: 'draft-1' },
      data: expect.objectContaining({
        status: SecretarySettingsDraftStatus.APPROVED,
        reviewedByUserId: 'doctor-1',
      }) as unknown,
    });
    expect(prismaServiceMock.commandIdempotency.create).toHaveBeenCalledTimes(
      1,
    );
  });

  it('rejects approval when the resulting active BookingQuestion count exceeds five', async () => {
    prismaServiceMock.bookingQuestion.findMany.mockResolvedValue(
      Array.from({ length: 5 }, (_, index) => ({
        id: `question-${index + 1}`,
        displayOrder: index,
        isActive: true,
      })),
    );
    prismaServiceMock.secretarySettingsDraftBookingQuestion.findMany.mockResolvedValue(
      [
        {
          id: 'proposal-new',
          bookingQuestionId: null,
          proposedDisplayOrder: 5,
          proposedIsActive: true,
        },
      ],
    );

    await expect(
      service.approve('doctor-1', 'draft-1', 'approve-key'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(
      prismaServiceMock.practiceLocationService.update,
    ).not.toHaveBeenCalled();
    expect(prismaServiceMock.bookingQuestion.create).not.toHaveBeenCalled();
    expect(
      prismaServiceMock.secretarySettingsDraft.update,
    ).not.toHaveBeenCalled();
  });

  it('rejects stale Service targets before applying effective settings', async () => {
    prismaServiceMock.secretarySettingsDraftService.findMany.mockResolvedValue([
      {
        practiceLocationServiceId: 'service-missing',
        sourceDoctorServiceTemplateId: null,
        proposedName: 'Consultation',
        proposedDurationMinutes: 30,
        proposedStatus: ServiceAvailabilityStatus.ACTIVE,
      },
    ]);
    prismaServiceMock.practiceLocationService.findMany.mockResolvedValue([]);

    await expect(
      service.approve('doctor-1', 'draft-1', 'approve-key'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(
      prismaServiceMock.practiceLocationService.update,
    ).not.toHaveBeenCalled();
    expect(
      prismaServiceMock.secretarySettingsDraft.update,
    ).not.toHaveBeenCalled();
  });

  it('denies approval to a user who is not the owning Doctor', async () => {
    prismaServiceMock.user.findUnique.mockResolvedValue({
      role: UserRole.DOCTOR,
      accountStatus: UserAccountStatus.ACTIVE,
      administrativeRestrictionStatus: AdministrativeRestrictionStatus.NONE,
    });
    prismaServiceMock.$queryRaw.mockReset();
    prismaServiceMock.$queryRaw
      .mockResolvedValueOnce([{ ...lockedDraft, doctorUserId: 'doctor-owner' }])
      .mockResolvedValueOnce([{ id: 'doctor-other' }]);

    await expect(
      service.approve('doctor-other', 'draft-1', 'approve-key'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(
      prismaServiceMock.secretarySettingsDraft.update,
    ).not.toHaveBeenCalled();
  });

  it('blocks ACTIVE-location approval when current cross-location schedule validation conflicts', async () => {
    const opensAt = new Date('2026-08-17T01:00:00.000Z');
    const closesAt = new Date('2026-08-17T09:00:00.000Z');
    prismaServiceMock.$queryRaw.mockReset();
    prismaServiceMock.$queryRaw
      .mockResolvedValueOnce([
        {
          ...lockedDraft,
          lifecycleStatus: PracticeLocationLifecycleStatus.ACTIVE,
        },
      ])
      .mockResolvedValueOnce([{ id: 'doctor-1' }]);
    prismaServiceMock.practiceSchedule.findMany.mockResolvedValue([
      { weekday: Weekday.MONDAY },
    ]);
    scheduleResolutionMock.resolveConfiguredSchedule.mockResolvedValue({
      isOpen: true,
      opensAt,
      closesAt,
    });
    doctorCalendarMock.isAvailableForInterval.mockResolvedValue(true);
    crossLocationConflictMock.assertNoConflictForInterval.mockRejectedValue(
      new ConflictException('Schedule conflict.'),
    );

    await expect(
      service.approve('doctor-1', 'draft-1', 'approve-conflict-key'),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(scheduleResolutionMock.resolveConfiguredSchedule).toHaveBeenCalled();
    expect(doctorCalendarMock.isAvailableForInterval).toHaveBeenCalledWith(
      'doctor-profile-1',
      opensAt,
      closesAt,
      prismaServiceMock,
    );
    expect(
      crossLocationConflictMock.assertNoConflictForInterval,
    ).toHaveBeenCalledWith(
      'doctor-profile-1',
      'location-1',
      opensAt,
      closesAt,
      prismaServiceMock,
    );
    expect(
      prismaServiceMock.secretarySettingsDraft.update,
    ).not.toHaveBeenCalled();
    expect(prismaServiceMock.commandIdempotency.create).not.toHaveBeenCalled();
  });

  it('replays a committed approval without applying settings twice', async () => {
    const fingerprint = createHash('sha256')
      .update(
        'PRACTICE_LOCATION_APPROVE_SETTINGS_DRAFT|doctor-1|draft-1',
        'utf8',
      )
      .digest('hex');
    prismaServiceMock.commandIdempotency.findUnique.mockResolvedValue({
      requestFingerprint: fingerprint,
    });

    await expect(
      service.approve('doctor-1', 'draft-1', 'approve-key'),
    ).resolves.toEqual({
      approved: true,
      replayed: true,
      draftId: 'draft-1',
      status: SecretarySettingsDraftStatus.APPROVED,
    });

    expect(
      prismaServiceMock.secretarySettingsDraftService.findMany,
    ).not.toHaveBeenCalled();
    expect(
      prismaServiceMock.secretarySettingsDraft.update,
    ).not.toHaveBeenCalled();
    expect(prismaServiceMock.commandIdempotency.create).not.toHaveBeenCalled();
  });
});
