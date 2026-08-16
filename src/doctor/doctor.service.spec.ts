import { Test, TestingModule } from '@nestjs/testing';
import {
  AdministrativeRestrictionStatus,
  UserAccountStatus,
  UserRole,
} from '../../generated/prisma/client';
import { EmailVerificationService } from '../auth/email-verification.service';
import { PasswordSecurityService } from '../auth/security/password-security.service';
import { PrismaService } from '../prisma/prisma.service';
import { MobileNumberService } from '../security/mobile-number/mobile-number.service';
import { DoctorService } from './doctor.service';

describe('DoctorService', () => {
  let service: DoctorService;

  let capturedUserCreateData: Record<string, unknown> | undefined;
  let capturedDoctorProfileCreateData: Record<string, unknown> | undefined;

  const transaction = {
    user: {
      create: jest.fn<
        Promise<{ id: string }>,
        [{ data: Record<string, unknown> }]
      >(),
    },
    doctorProfile: {
      create: jest.fn<
        Promise<{ id: string }>,
        [{ data: Record<string, unknown> }]
      >(),
    },
    doctorAccountSettings: {
      create: jest.fn<
        Promise<{ id: string }>,
        [{ data: Record<string, unknown> }]
      >(),
    },
  };
  const prismaServiceMock = {
    user: { findFirst: jest.fn() },
    $transaction: jest.fn(),
    $queryRaw: jest.fn(),
  };
  const mobileNumberServiceMock = {
    normalize: jest.fn(() => ({
      canonical: '+639171234567',
      lastFour: '4567',
    })),
  };
  const emailVerificationServiceMock = {
    createInitialVerification: jest.fn(),
  };
  const passwordSecurityServiceMock = {
    hash: jest.fn().mockResolvedValue('secure-hash'),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DoctorService,
        {
          provide: PrismaService,
          useValue: prismaServiceMock,
        },
        {
          provide: MobileNumberService,
          useValue: mobileNumberServiceMock,
        },
        {
          provide: EmailVerificationService,
          useValue: emailVerificationServiceMock,
        },
        {
          provide: PasswordSecurityService,
          useValue: passwordSecurityServiceMock,
        },
      ],
    }).compile();

    service = module.get<DoctorService>(DoctorService);

    jest.clearAllMocks();
    capturedUserCreateData = undefined;
    capturedDoctorProfileCreateData = undefined;
    transaction.user.create.mockImplementation(
      ({ data }: { data: Record<string, unknown> }) => {
        capturedUserCreateData = data;
        return Promise.resolve({ id: 'user-1' });
      },
    );
    transaction.doctorProfile.create.mockImplementation(
      ({ data }: { data: Record<string, unknown> }) => {
        capturedDoctorProfileCreateData = data;
        return Promise.resolve({ id: 'profile-1' });
      },
    );
    prismaServiceMock.$transaction.mockImplementation(
      (callback: (tx: typeof transaction) => Promise<unknown>) =>
        callback(transaction),
    );
    prismaServiceMock.user.findFirst.mockResolvedValue(null);
    transaction.doctorAccountSettings.create.mockResolvedValue({
      id: 'settings-1',
    });
    emailVerificationServiceMock.createInitialVerification.mockResolvedValue({
      id: 'verification-1',
      expiresAt: new Date('2026-08-16T00:00:00.000Z'),
    });
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('creates Doctor account records and verification intent inside one transaction', async () => {
    const result = await service.registerDoctor({
      firstName: '  Jane ',
      middleName: ' Q ',
      lastName: ' Doe ',
      email: ' Jane.Doctor@Example.COM ',
      mobileNumber: '0917 123 4567',
      password: 'transient-password',
      professionalTitle: ' Dr. ',
      specialization: ' Family Medicine ',
      licenseNumber: ' LIC-123 ',
    });

    expect(prismaServiceMock.user.findFirst).toHaveBeenCalledWith({
      where: {
        email: 'jane.doctor@example.com',
        accountStatus: { not: UserAccountStatus.PERMANENTLY_CLOSED },
      },
      select: { id: true },
    });
    expect(capturedUserCreateData).toMatchObject({
      email: 'jane.doctor@example.com',
      firstName: 'Jane',
      middleName: 'Q',
      lastName: 'Doe',
      mobileNumber: '+639171234567',
      passwordHash: 'secure-hash',
      role: UserRole.DOCTOR,
      accountStatus: UserAccountStatus.ACTIVE,
      administrativeRestrictionStatus: AdministrativeRestrictionStatus.NONE,
      emailVerifiedAt: null,
    });

    expect(capturedDoctorProfileCreateData).toMatchObject({
      userId: 'user-1',
      professionalTitle: 'Dr.',
      specialization: 'Family Medicine',
      licenseNumber: 'LIC-123',
      isProfilePublic: false,
    });
    expect(transaction.doctorAccountSettings.create).toHaveBeenCalledWith({
      data: {
        doctorProfileId: 'profile-1',
        defaultTimeZone: 'Asia/Manila',
        defaultConsultationMinutes: 30,
        maximumAdvanceBookingDays: 30,
        allowOnlineBooking: true,
      },
    });
    expect(
      emailVerificationServiceMock.createInitialVerification,
    ).toHaveBeenCalledWith(transaction, 'user-1', 'jane.doctor@example.com');
    expect(result).toEqual({
      userId: 'user-1',
      doctorProfileId: 'profile-1',
      emailVerificationRequired: true,
      emailVerificationExpiresAt: new Date('2026-08-16T00:00:00.000Z'),
    });
    expect(JSON.stringify(result)).not.toContain('transient-password');
  });

  it('reads the Doctor-wide per-patient duration cap', async () => {
    prismaServiceMock.$queryRaw.mockResolvedValue([
      { maximumEstimatedServiceMinutesPerPatient: 60 },
    ]);

    await expect(service.getAccountSettings('doctor-user')).resolves.toEqual({
      maximumEstimatedServiceMinutesPerPatient: 60,
    });
  });

  it('sets or clears the Doctor-wide per-patient duration cap', async () => {
    prismaServiceMock.$queryRaw
      .mockResolvedValueOnce([{ maximumEstimatedServiceMinutesPerPatient: 45 }])
      .mockResolvedValueOnce([
        { maximumEstimatedServiceMinutesPerPatient: null },
      ]);

    const setResult = await service.updateAccountSettings('doctor-user', {
      maximumEstimatedServiceMinutesPerPatient: 45,
    });
    expect(setResult).toEqual({
      maximumEstimatedServiceMinutesPerPatient: 45,
    });

    const clearResult = await service.updateAccountSettings('doctor-user', {
      maximumEstimatedServiceMinutesPerPatient: null,
    });
    expect(clearResult).toEqual({
      maximumEstimatedServiceMinutesPerPatient: null,
    });
  });

  it('rejects an out-of-range per-patient duration cap before writing', async () => {
    await expect(
      service.updateAccountSettings('doctor-user', {
        maximumEstimatedServiceMinutesPerPatient: 4321,
      }),
    ).rejects.toThrow(
      'Maximum estimated service minutes per patient must be between 1 and 4320 minutes, or null for no cap.',
    );

    expect(prismaServiceMock.$queryRaw).not.toHaveBeenCalled();
  });

  it('rejects an invalid Doctor-wide IANA time zone before writing', async () => {
    await expect(
      service.registerDoctor({
        firstName: 'Jane',
        lastName: 'Doe',
        email: 'jane@example.com',
        mobileNumber: '09171234567',
        password: 'password',
        professionalTitle: 'Dr.',
        specialization: 'Medicine',
        licenseNumber: 'LIC-789',
        defaultTimeZone: 'Not/A-Time-Zone',
      }),
    ).rejects.toThrow('defaultTimeZone must be a valid IANA time zone.');

    expect(prismaServiceMock.$transaction).not.toHaveBeenCalled();
  });

  it('treats only a current non-permanently-closed account as an email conflict', async () => {
    prismaServiceMock.user.findFirst.mockResolvedValue({ id: 'current-user' });

    await expect(
      service.registerDoctor({
        firstName: 'Jane',
        lastName: 'Doe',
        email: 'jane@example.com',
        mobileNumber: '09171234567',
        password: 'password',
        professionalTitle: 'Dr.',
        specialization: 'Medicine',
        licenseNumber: 'LIC-456',
      }),
    ).rejects.toThrow('A current account already uses this email.');

    expect(prismaServiceMock.$transaction).not.toHaveBeenCalled();
  });
});
