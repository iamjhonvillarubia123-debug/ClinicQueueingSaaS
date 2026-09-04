import { DoctorAuditService } from './doctor-audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { SessionManagementService } from '../auth/session-management.service';
import { Prisma, UserRole } from '../../generated/prisma/client';
describe('Doctor audit read model', () => {
  const tx = { $queryRaw: jest.fn() };
  const sessions = { validateActor: jest.fn() };
  const prisma = {
    $transaction: (fn: (transaction: typeof tx) => unknown) => fn(tx),
  };
  const audit = new DoctorAuditService(
    prisma as unknown as PrismaService,
    sessions as unknown as SessionManagementService,
  );
  const actor = {
    userId: 'owner',
    sessionId: 'session',
    role: UserRole.DOCTOR,
  };
  beforeEach(() => {
    jest.resetAllMocks();
    tx.$queryRaw
      .mockResolvedValueOnce([{ total: 1n, clinics: 1n, actors: 1n }])
      .mockResolvedValueOnce([]);
  });
  it('owner-scopes both totals and rows and omits patient information', async () => {
    const result = await audit.list(actor, '2026-09-01', '2026-09-03', 1);
    expect(result.total).toBe(1);
    for (const [query] of tx.$queryRaw.mock.calls as [Prisma.Sql][]) {
      expect(query.sql).toContain('d."userId" =');
      expect(query.values).toContain('owner');
      expect(query.sql).not.toContain('AppointmentAnswer');
      expect(query.sql).not.toContain('metadata');
    }
  });
  it('rejects invalid dates, reversed ranges and pages before reading', async () => {
    for (const [from, to, page] of [
      ['2026-02-30', '2026-03-01', 1],
      ['2026-09-03', '2026-09-01', 1],
      ['2026-09-01', '2026-09-03', -1],
    ] as const)
      await expect(audit.list(actor, from, to, page)).rejects.toThrow('valid');
    expect(tx.$queryRaw).not.toHaveBeenCalled();
  });
});
