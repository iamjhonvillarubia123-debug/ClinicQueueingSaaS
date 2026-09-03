import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { DoctorDefaultsApplyService } from './doctor-defaults-apply.service';

describe('Additive defaults copying', () => {
  const serviceTemplate = {
    id: 's1',
    name: 'Consultation',
    durationMinutes: 20,
    status: 'ACTIVE',
  };
  const questionTemplate = {
    id: 'q1',
    questionText: 'Reason?',
    displayOrder: 0,
    isActive: true,
    type: 'TEXT',
    selectOptions: null,
  };
  let existing: {
    id: string;
    sourceDoctorBookingQuestionTemplateId: string | null;
    displayOrder: number;
    isActive: boolean;
  }[];
  const tx = {
    user: { findUnique: jest.fn() },
    commandIdempotency: { findUnique: jest.fn(), create: jest.fn() },
    practiceLocation: { findMany: jest.fn() },
    doctorServiceTemplate: { findMany: jest.fn() },
    doctorBookingQuestionTemplate: { findMany: jest.fn() },
    practiceLocationService: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    $queryRaw: jest.fn(),
    $executeRaw: jest.fn(),
  };
  let service: DoctorDefaultsApplyService;
  beforeEach(() => {
    jest.resetAllMocks();
    existing = [];
    tx.user.findUnique.mockResolvedValue({
      role: 'DOCTOR',
      accountStatus: 'ACTIVE',
      administrativeRestrictionStatus: 'NONE',
      doctorProfile: { id: 'doctor' },
    });
    tx.practiceLocation.findMany.mockResolvedValue([
      { id: 'clinic', doctorProfileId: 'doctor', lifecycleStatus: 'ACTIVE' },
    ]);
    tx.doctorServiceTemplate.findMany.mockResolvedValue([serviceTemplate]);
    tx.doctorBookingQuestionTemplate.findMany.mockResolvedValue([
      questionTemplate,
    ]);
    tx.commandIdempotency.create.mockResolvedValue({ id: 'command' });
    tx.practiceLocationService.create.mockResolvedValue({ id: 'copy' });
    tx.$queryRaw.mockImplementation((sql: Prisma.Sql) =>
      Promise.resolve(
        sql.sql.includes('FROM "BookingQuestion"') ? existing : [],
      ),
    );
    const prisma = {
      $transaction: (callback: (client: typeof tx) => unknown) => callback(tx),
    };
    service = new DoctorDefaultsApplyService(
      prisma as unknown as PrismaService,
    );
  });
  it('preserves clinic edits and inactive source-linked questions without writing updates', async () => {
    existing = [
      {
        id: 'old',
        sourceDoctorBookingQuestionTemplateId: 'q1',
        displayOrder: 7,
        isActive: false,
      },
    ];
    tx.practiceLocationService.findFirst.mockResolvedValue({
      id: 'existing-service',
    });
    await service.apply('owner', { practiceLocationIds: ['clinic'] }, 'key');
    expect(tx.practiceLocationService.update).not.toHaveBeenCalled();
    expect(tx.practiceLocationService.create).not.toHaveBeenCalled();
    const sql = tx.$executeRaw.mock.calls
      .map((call: [Prisma.Sql]) => call[0].sql)
      .join('\n');
    expect(sql).not.toContain('INSERT INTO "BookingQuestion"');
    expect(sql).not.toContain('UPDATE "BookingQuestion"');
  });
  it('appends new questions after local order and selects only requested kinds', async () => {
    existing = [
      {
        id: 'local',
        sourceDoctorBookingQuestionTemplateId: null,
        displayOrder: 9,
        isActive: true,
      },
    ];
    await service.apply(
      'owner',
      {
        practiceLocationIds: ['clinic'],
        serviceTemplateIds: [],
        bookingQuestionTemplateIds: ['q1'],
      },
      'key',
    );
    expect(tx.practiceLocationService.create).not.toHaveBeenCalled();
    const insert = tx.$executeRaw.mock.calls
      .map((call: [Prisma.Sql]) => call[0])
      .find((sql) => sql.sql.includes('INSERT INTO "BookingQuestion"'))!;
    expect(insert.values).toContain(10);
    expect(insert.values).toContain('q1');
  });
  it('rejects capacity overflow before any durable command or configuration write', async () => {
    existing = Array.from({ length: 5 }, (_, index) => ({
      id: String(index),
      sourceDoctorBookingQuestionTemplateId: null,
      displayOrder: index,
      isActive: true,
    }));
    await expect(
      service.apply('owner', { practiceLocationIds: ['clinic'] }, 'key'),
    ).rejects.toThrow('five active');
    expect(tx.commandIdempotency.create).not.toHaveBeenCalled();
    expect(tx.practiceLocationService.create).not.toHaveBeenCalled();
  });
  it('does not count already copied active questions twice at capacity', async () => {
    existing = Array.from({ length: 5 }, (_, index) => ({
      id: String(index),
      sourceDoctorBookingQuestionTemplateId: index === 0 ? 'q1' : null,
      displayOrder: index,
      isActive: true,
    }));
    await expect(
      service.apply(
        'owner',
        { practiceLocationIds: ['clinic'], serviceTemplateIds: [] },
        'key',
      ),
    ).resolves.toMatchObject({ applied: true });
  });
  it('rejects a foreign clinic and a foreign template', async () => {
    tx.practiceLocation.findMany.mockResolvedValueOnce([
      { id: 'clinic', doctorProfileId: 'other' },
    ]);
    await expect(
      service.apply('owner', { practiceLocationIds: ['clinic'] }, 'key'),
    ).rejects.toThrow('owned by');
    await expect(
      service.apply(
        'owner',
        { practiceLocationIds: ['clinic'], serviceTemplateIds: ['foreign'] },
        'key',
      ),
    ).rejects.toThrow('your own');
    expect(tx.commandIdempotency.create).not.toHaveBeenCalled();
  });
  it('fingerprints selections and rejects reuse for another selection', async () => {
    tx.commandIdempotency.findUnique.mockResolvedValue({
      id: 'old',
      requestFingerprint: 'different',
    });
    await expect(
      service.apply(
        'owner',
        { practiceLocationIds: ['clinic'], serviceTemplateIds: [] },
        'key',
      ),
    ).rejects.toThrow('different defaults');
    expect(tx.commandIdempotency.create).not.toHaveBeenCalled();
  });
});
