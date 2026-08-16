import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import {
  BookingQuestionType,
  PracticeLocationLifecycleStatus,
  SecretarySettingsDraftStatus,
} from '../../generated/prisma/client';
import { SecretarySettingsDraftBookingQuestionService } from './secretary-settings-draft-booking-question.service';

describe('SecretarySettingsDraftBookingQuestionService', () => {
  let service: SecretarySettingsDraftBookingQuestionService;

  const prismaServiceMock = {
    $transaction: jest.fn(),
    $queryRaw: jest.fn(),
    bookingQuestion: { findFirst: jest.fn() },
    secretarySettingsDraftBookingQuestion: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  };

  const textProposal = {
    questionText: 'Reason for visit?',
    helpText: 'Short administrative description only.',
    type: BookingQuestionType.TEXT,
    isRequired: true,
    displayOrder: 0,
    isActive: true,
    textMaximumLength: 200,
  };

  const effectiveTextQuestion = {
    id: 'question-1',
    questionText: 'Reason for visit?',
    type: BookingQuestionType.TEXT,
    selectOptions: null,
    _count: {
      bookingDraftAnswers: 0,
      appointmentAnswers: 0,
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new SecretarySettingsDraftBookingQuestionService(
      prismaServiceMock as never,
    );
    prismaServiceMock.$transaction.mockImplementation(
      (callback: (transaction: typeof prismaServiceMock) => unknown) =>
        callback(prismaServiceMock),
    );
    prismaServiceMock.$queryRaw.mockResolvedValue([
      {
        id: 'draft-1',
        practiceLocationId: 'location-1',
        status: SecretarySettingsDraftStatus.DRAFT,
        lifecycleStatus: PracticeLocationLifecycleStatus.ACTIVE,
        currentRegularPracticeStaffId: 'staff-1',
        currentSecretaryUserId: 'secretary-1',
        currentAssignmentActive: true,
      },
    ]);
    prismaServiceMock.bookingQuestion.findFirst.mockResolvedValue(
      effectiveTextQuestion,
    );
    prismaServiceMock.secretarySettingsDraftBookingQuestion.findFirst.mockResolvedValue(
      null,
    );
    prismaServiceMock.secretarySettingsDraftBookingQuestion.create.mockResolvedValue(
      { id: 'proposal-1', proposedIsActive: true },
    );
    prismaServiceMock.secretarySettingsDraftBookingQuestion.update.mockResolvedValue(
      { id: 'proposal-1', proposedIsActive: false },
    );
  });

  it('creates a new BookingQuestion proposal without changing effective BookingQuestion', async () => {
    await expect(
      service.createProposal('secretary-1', 'draft-1', textProposal),
    ).resolves.toEqual({
      saved: true,
      draftId: 'draft-1',
      proposalId: 'proposal-1',
      bookingQuestionId: null,
      proposedIsActive: true,
    });

    expect(
      prismaServiceMock.secretarySettingsDraftBookingQuestion.create,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          proposedEstimatedMinutesAdjustment: 0,
        }) as unknown,
      }),
    );
    expect(prismaServiceMock.bookingQuestion.findFirst).not.toHaveBeenCalled();
  });

  it('creates an edit proposal only for an effective question owned by the draft location', async () => {
    await expect(
      service.upsertExistingQuestionProposal(
        'secretary-1',
        'draft-1',
        'question-1',
        textProposal,
      ),
    ).resolves.toEqual({
      saved: true,
      draftId: 'draft-1',
      proposalId: 'proposal-1',
      bookingQuestionId: 'question-1',
      proposedIsActive: true,
    });
  });

  it('reuses the existing draft proposal when proposing deactivation', async () => {
    prismaServiceMock.secretarySettingsDraftBookingQuestion.findFirst.mockResolvedValue(
      { id: 'proposal-1' },
    );

    await expect(
      service.upsertExistingQuestionProposal(
        'secretary-1',
        'draft-1',
        'question-1',
        { ...textProposal, isActive: false },
      ),
    ).resolves.toEqual({
      saved: true,
      draftId: 'draft-1',
      proposalId: 'proposal-1',
      bookingQuestionId: 'question-1',
      proposedIsActive: false,
    });

    expect(
      prismaServiceMock.secretarySettingsDraftBookingQuestion.update,
    ).toHaveBeenCalled();
  });

  it('rejects protected meaning changes after answer history exists', async () => {
    prismaServiceMock.bookingQuestion.findFirst.mockResolvedValue({
      ...effectiveTextQuestion,
      _count: {
        bookingDraftAnswers: 1,
        appointmentAnswers: 0,
      },
    });

    await expect(
      service.upsertExistingQuestionProposal(
        'secretary-1',
        'draft-1',
        'question-1',
        { ...textProposal, questionText: 'Different historical meaning?' },
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(
      prismaServiceMock.secretarySettingsDraftBookingQuestion.create,
    ).not.toHaveBeenCalled();
  });

  it('allows deactivation and operational edits after answer history exists when meaning is unchanged', async () => {
    prismaServiceMock.bookingQuestion.findFirst.mockResolvedValue({
      ...effectiveTextQuestion,
      _count: {
        bookingDraftAnswers: 0,
        appointmentAnswers: 1,
      },
    });

    await expect(
      service.upsertExistingQuestionProposal(
        'secretary-1',
        'draft-1',
        'question-1',
        {
          ...textProposal,
          helpText: 'Updated guidance.',
          displayOrder: 4,
          isActive: false,
        },
      ),
    ).resolves.toEqual(
      expect.objectContaining({
        saved: true,
        bookingQuestionId: 'question-1',
      }),
    );
  });

  it('validates SINGLE_SELECT option shape and unique values', async () => {
    await expect(
      service.createProposal('secretary-1', 'draft-1', {
        ...textProposal,
        type: BookingQuestionType.SINGLE_SELECT,
        textMaximumLength: undefined,
        selectOptions: [
          { value: 'new', label: 'New patient' },
          { value: 'new', label: 'Returning patient' },
        ],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects type-specific fields that do not belong to the selected type', async () => {
    await expect(
      service.createProposal('secretary-1', 'draft-1', {
        ...textProposal,
        type: BookingQuestionType.BOOLEAN,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects an existing question from another PracticeLocation', async () => {
    prismaServiceMock.bookingQuestion.findFirst.mockResolvedValue(null);

    await expect(
      service.upsertExistingQuestionProposal(
        'secretary-1',
        'draft-1',
        'question-other',
        textProposal,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('denies the outgoing Secretary after regular Secretary replacement', async () => {
    prismaServiceMock.$queryRaw.mockResolvedValue([
      {
        id: 'draft-1',
        practiceLocationId: 'location-1',
        status: SecretarySettingsDraftStatus.DRAFT,
        lifecycleStatus: PracticeLocationLifecycleStatus.ACTIVE,
        currentRegularPracticeStaffId: 'staff-new',
        currentSecretaryUserId: 'secretary-new',
        currentAssignmentActive: true,
      },
    ]);

    await expect(
      service.createProposal('secretary-old', 'draft-1', textProposal),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('blocks BookingQuestion proposal edits while the draft is submitted', async () => {
    prismaServiceMock.$queryRaw.mockResolvedValue([
      {
        id: 'draft-1',
        practiceLocationId: 'location-1',
        status: SecretarySettingsDraftStatus.SUBMITTED,
        lifecycleStatus: PracticeLocationLifecycleStatus.ACTIVE,
        currentRegularPracticeStaffId: 'staff-1',
        currentSecretaryUserId: 'secretary-1',
        currentAssignmentActive: true,
      },
    ]);

    await expect(
      service.createProposal('secretary-1', 'draft-1', textProposal),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
