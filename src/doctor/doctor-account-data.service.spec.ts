import { DoctorAccountDataService } from './doctor-account-data.service';
import { PrismaService } from '../prisma/prisma.service';
import { SessionManagementService } from '../auth/session-management.service';
import { PasswordSecurityService } from '../auth/security/password-security.service';
import { UserRole } from '../../generated/prisma/client';

describe('Account-only data downloads', () => {
  const tx = {
    user: { findUnique: jest.fn() },
    doctorProfile: { findUnique: jest.fn() },
    doctorDataRetentionAcknowledgement: { findMany: jest.fn() },
  };
  const sessions = { validateActor: jest.fn() };
  const passwords = { verify: jest.fn() };
  const prisma = {
    $transaction: (fn: (transaction: typeof tx) => unknown) => fn(tx),
  };
  const service = new DoctorAccountDataService(
    prisma as unknown as PrismaService,
    sessions as unknown as SessionManagementService,
    passwords as unknown as PasswordSecurityService,
  );
  const actor = {
    userId: 'owner',
    sessionId: 'session',
    role: UserRole.DOCTOR,
  };
  beforeEach(() => {
    jest.resetAllMocks();
    sessions.validateActor.mockResolvedValue({ passwordHash: 'private' });
    passwords.verify.mockResolvedValue(true);
    tx.user.findUnique.mockResolvedValue({
      id: 'owner',
      email: 'owner@example.test',
    });
    tx.doctorProfile.findUnique.mockResolvedValue({
      accountSettings: { defaultTimeZone: 'Asia/Manila' },
    });
    tx.doctorDataRetentionAcknowledgement.findMany.mockResolvedValue([]);
  });
  it('uses explicit own-account allowlists, not user-supplied account IDs or patient relations', async () => {
    const result = await service.export(actor, 'current', false);
    expect(result.patientDataIncluded).toBe(false);
    expect(result.account).toEqual({
      id: 'owner',
      email: 'owner@example.test',
    });
    const query = (tx.user.findUnique.mock.calls as unknown[][])[0][0] as {
      where: object;
      select: Record<string, boolean>;
    };
    expect(query.where).toEqual({ id: 'owner' });
    expect(Object.keys(query.select).sort()).toEqual(
      [
        'id',
        'firstName',
        'middleName',
        'lastName',
        'email',
        'mobileNumber',
        'role',
        'accountStatus',
        'emailVerifiedAt',
        'createdAt',
      ].sort(),
    );
    expect(JSON.stringify(result)).not.toContain('private');
  });
  it('does not expose account identity in a settings backup', async () => {
    const result = await service.export(actor, 'current', true);
    expect(result.account).toBeUndefined();
    expect(tx.user.findUnique).not.toHaveBeenCalled();
    expect(
      tx.doctorDataRetentionAcknowledgement.findMany,
    ).not.toHaveBeenCalled();
  });
  it('rejects incorrect passwords before reading export data', async () => {
    passwords.verify.mockResolvedValue(false);
    await expect(service.export(actor, 'wrong', false)).rejects.toThrow(
      'incorrect',
    );
    expect(tx.doctorProfile.findUnique).not.toHaveBeenCalled();
  });
  it('does not fabricate worker activity', async () => {
    const result = await service.inventory(actor);
    expect(result.erasureWorker.status).toBe('UNKNOWN');
    expect(result.erasureWorker.lastSuccessfulRunAt).toBeNull();
  });
});
