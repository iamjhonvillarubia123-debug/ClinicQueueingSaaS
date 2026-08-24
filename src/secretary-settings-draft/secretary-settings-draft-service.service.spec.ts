import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import {
  PracticeLocationLifecycleStatus,
  SecretarySettingsDraftStatus,
  ServiceAvailabilityStatus,
} from '../../generated/prisma/client';
import { SecretarySettingsDraftServiceProposalService } from './secretary-settings-draft-service.service';

describe('SecretarySettingsDraftServiceProposalService', () => {
  let service: SecretarySettingsDraftServiceProposalService;

  const prismaServiceMock = {
    $transaction: jest.fn(),
    $queryRaw: jest.fn(),
    practiceLocationService: { findFirst: jest.fn(), aggregate: jest.fn() },
    secretarySettingsDraftService: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      aggregate: jest.fn(),
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new SecretarySettingsDraftServiceProposalService(
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
    prismaServiceMock.practiceLocationService.aggregate.mockResolvedValue({
      _max: { displayOrder: 1 },
    });
    prismaServiceMock.secretarySettingsDraftService.aggregate.mockResolvedValue({
      _max: { proposedDisplayOrder: null },
    });
    prismaServiceMock.secretarySettingsDraftService.create.mockResolvedValue({
      id: 'proposal-1',
      proposedStatus: ServiceAvailabilityStatus.ACTIVE,
      proposedDisplayOrder: 2,
    });
    prismaServiceMock.secretarySettingsDraftService.update.mockResolvedValue({
      id: 'proposal-1',
      proposedStatus: ServiceAvailabilityStatus.ACTIVE,
      proposedDisplayOrder: 0,
    });
    prismaServiceMock.secretarySettingsDraftService.findFirst.mockResolvedValue(
      null,
    );
  });

  it('creates a new Service proposal with the next presentation order without changing effective PracticeLocationService', async () => {
    await expect(
      service.createProposal('secretary-1', 'draft-1', {
        name: 'Consultation',
        durationMinutes: 30,
        status: ServiceAvailabilityStatus.ACTIVE,
      }),
    ).resolves.toEqual({
      saved: true,
      draftId: 'draft-1',
      proposalId: 'proposal-1',
      practiceLocationServiceId: null,
      proposedStatus: ServiceAvailabilityStatus.ACTIVE,
      proposedDisplayOrder: 2,
    });

    expect(
      prismaServiceMock.secretarySettingsDraftService.create,
    ).toHaveBeenCalledWith({
      data: {
        secretarySettingsDraftId: 'draft-1',
        practiceLocationServiceId: null,
        sourceDoctorServiceTemplateId: null,
        proposedName: 'Consultation',
        proposedDurationMinutes: 30,
        proposedStatus: ServiceAvailabilityStatus.ACTIVE,
        proposedDisplayOrder: 2,
      },
    });
    expect(
      prismaServiceMock.practiceLocationService.findFirst,
    ).not.toHaveBeenCalled();
  });

  it('creates an edit proposal for an existing Service owned by the same location', async () => {
    prismaServiceMock.practiceLocationService.findFirst.mockResolvedValue({
      id: 'service-1',
      sourceDoctorServiceTemplateId: 'template-1',
      displayOrder: 4,
    });
    prismaServiceMock.secretarySettingsDraftService.create.mockResolvedValue({
      id: 'proposal-1',
      proposedStatus: ServiceAvailabilityStatus.ACTIVE,
      proposedDisplayOrder: 1,
    });

    await expect(
      service.upsertExistingServiceProposal(
        'secretary-1',
        'draft-1',
        'service-1',
        {
          name: 'Extended consultation',
          durationMinutes: 45,
          status: ServiceAvailabilityStatus.ACTIVE,
          displayOrder: 1,
        },
      ),
    ).resolves.toEqual({
      saved: true,
      draftId: 'draft-1',
      proposalId: 'proposal-1',
      practiceLocationServiceId: 'service-1',
      proposedStatus: ServiceAvailabilityStatus.ACTIVE,
      proposedDisplayOrder: 1,
    });

    expect(
      prismaServiceMock.secretarySettingsDraftService.create,
    ).toHaveBeenCalledWith({
      data: {
        secretarySettingsDraftId: 'draft-1',
        practiceLocationServiceId: 'service-1',
        sourceDoctorServiceTemplateId: 'template-1',
        proposedName: 'Extended consultation',
        proposedDurationMinutes: 45,
        proposedStatus: ServiceAvailabilityStatus.ACTIVE,
        proposedDisplayOrder: 1,
      },
    });
  });

  it('reuses the existing draft proposal when proposing Service deactivation and preserves its order', async () => {
    prismaServiceMock.practiceLocationService.findFirst.mockResolvedValue({
      id: 'service-1',
      sourceDoctorServiceTemplateId: null,
      displayOrder: 3,
    });
    prismaServiceMock.secretarySettingsDraftService.findFirst.mockResolvedValue(
      {
        id: 'proposal-1',
        proposedDisplayOrder: 3,
      },
    );
    prismaServiceMock.secretarySettingsDraftService.update.mockResolvedValue({
      id: 'proposal-1',
      proposedStatus: ServiceAvailabilityStatus.INACTIVE,
      proposedDisplayOrder: 3,
    });

    await expect(
      service.upsertExistingServiceProposal(
        'secretary-1',
        'draft-1',
        'service-1',
        {
          name: 'Consultation',
          durationMinutes: 30,
          status: ServiceAvailabilityStatus.INACTIVE,
        },
      ),
    ).resolves.toEqual({
      saved: true,
      draftId: 'draft-1',
      proposalId: 'proposal-1',
      practiceLocationServiceId: 'service-1',
      proposedStatus: ServiceAvailabilityStatus.INACTIVE,
      proposedDisplayOrder: 3,
    });

    expect(
      prismaServiceMock.secretarySettingsDraftService.update,
    ).toHaveBeenCalledWith({
      where: { id: 'proposal-1' },
      data: {
        proposedName: 'Consultation',
        proposedDurationMinutes: 30,
        proposedStatus: ServiceAvailabilityStatus.INACTIVE,
        proposedDisplayOrder: 3,
      },
    });
  });

  it('updates a newly created proposal by proposal identity and accepts a reordered position', async () => {
    prismaServiceMock.secretarySettingsDraftService.findFirst.mockResolvedValue(
      {
        id: 'proposal-new',
        practiceLocationServiceId: null,
        proposedDisplayOrder: 4,
      },
    );
    prismaServiceMock.secretarySettingsDraftService.update.mockResolvedValue({
      id: 'proposal-new',
      proposedStatus: ServiceAvailabilityStatus.ACTIVE,
      proposedDisplayOrder: 0,
    });

    await expect(
      service.updateProposal('secretary-1', 'draft-1', 'proposal-new', {
        name: 'Follow-up consultation',
        durationMinutes: 20,
        status: ServiceAvailabilityStatus.ACTIVE,
        displayOrder: 0,
      }),
    ).resolves.toEqual({
      saved: true,
      draftId: 'draft-1',
      proposalId: 'proposal-new',
      practiceLocationServiceId: null,
      proposedStatus: ServiceAvailabilityStatus.ACTIVE,
      proposedDisplayOrder: 0,
    });
  });

  it('rejects an existing Service that does not belong to the draft PracticeLocation', async () => {
    prismaServiceMock.practiceLocationService.findFirst.mockResolvedValue(null);

    await expect(
      service.upsertExistingServiceProposal(
        'secretary-1',
        'draft-1',
        'service-other-location',
        {
          name: 'Consultation',
          durationMinutes: 30,
          status: ServiceAvailabilityStatus.ACTIVE,
        },
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects invalid Service duration even when called below the HTTP validation boundary', async () => {
    await expect(
      service.createProposal('secretary-1', 'draft-1', {
        name: 'Consultation',
        durationMinutes: 0,
        status: ServiceAvailabilityStatus.ACTIVE,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects an invalid presentation order below the HTTP validation boundary', async () => {
    await expect(
      service.createProposal('secretary-1', 'draft-1', {
        name: 'Consultation',
        durationMinutes: 30,
        status: ServiceAvailabilityStatus.ACTIVE,
        displayOrder: -1,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
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
      service.createProposal('secretary-old', 'draft-1', {
        name: 'Consultation',
        durationMinutes: 30,
        status: ServiceAvailabilityStatus.ACTIVE,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('blocks Service proposal edits while the draft is submitted', async () => {
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
      service.createProposal('secretary-1', 'draft-1', {
        name: 'Consultation',
        durationMinutes: 30,
        status: ServiceAvailabilityStatus.ACTIVE,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
