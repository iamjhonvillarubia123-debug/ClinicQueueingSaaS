import { NotFoundException } from '@nestjs/common';
import { SubscriptionEntitlementService } from '../financial/subscription-entitlement.service';
import { PrismaService } from '../prisma/prisma.service';
import { PublicRoutingService } from './public-routing.service';

describe('PublicRoutingService', () => {
  const prisma = {
    doctorProfile: { findUnique: jest.fn() },
    practiceLocation: { findUnique: jest.fn() },
  };
  const subscriptionEntitlement = {
    evaluateForFinancialAccount: jest.fn(),
  };

  const service = new PublicRoutingService(
    prisma as unknown as PrismaService,
    subscriptionEntitlement as unknown as SubscriptionEntitlementService,
  );

  beforeEach(() => {
    jest.resetAllMocks();
  });

  const doctorProfile = (overrides: Record<string, unknown> = {}) => ({
    publicIdentifier: 'doctor-public-id',
    publicSlug: 'dr-sample',
    isProfilePublic: true,
    middleName: 'M',
    suffix: null,
    professionalTitle: 'Dr.',
    specialization: 'Family Medicine',
    profileDescription: 'Public profile',
    profilePhotoUrl: null,
    user: {
      id: 'doctor-user-id',
      firstName: 'Ana',
      lastName: 'Santos',
      accountStatus: 'ACTIVE',
      administrativeRestrictionStatus: 'NONE',
      doctorFinancialAccount: { id: 'financial-account-id' },
    },
    practiceLocations: [
      {
        publicIdentifier: 'location-public-id',
        lifecycleStatus: 'ACTIVE',
        isBookingEnabled: true,
        name: 'Main Clinic',
        cityMunicipality: 'Quezon City',
        province: 'Metro Manila',
      },
    ],
    ...overrides,
  });

  const locationRecord = (overrides: Record<string, unknown> = {}) => ({
    publicIdentifier: 'location-public-id',
    lifecycleStatus: 'ACTIVE',
    isBookingEnabled: true,
    name: 'Main Clinic',
    addressLine1: '1 Clinic Street',
    addressLine2: null,
    cityMunicipality: 'Quezon City',
    province: 'Metro Manila',
    postalCode: '1100',
    countryCode: 'PH',
    timeZone: 'Asia/Manila',
    doctorProfile: doctorProfile({ practiceLocations: undefined }),
    services: [{ name: 'Consultation' }],
    ...overrides,
  });

  const allowSubscription = () =>
    subscriptionEntitlement.evaluateForFinancialAccount.mockResolvedValue({
      allowsNewSubscriptionGatedActivity: true,
    });

  it('returns a published Doctor route with only approved public identity fields', async () => {
    prisma.doctorProfile.findUnique.mockResolvedValue(doctorProfile());
    allowSubscription();

    const result = await service.getDoctorPublicRoute(' doctor-public-id ');

    expect(result.routeStatus).toBe('AVAILABLE');
    expect(result.bookingEntryAllowed).toBe(true);
    expect(result.doctor).toEqual({
      publicIdentifier: 'doctor-public-id',
      publicSlug: 'dr-sample',
      firstName: 'Ana',
      middleName: 'M',
      lastName: 'Santos',
      suffix: null,
      professionalTitle: 'Dr.',
      specialization: 'Family Medicine',
      profileDescription: 'Public profile',
      profilePhotoUrl: null,
    });
    expect(result).not.toHaveProperty('userId');
    expect(result).not.toHaveProperty('email');
  });

  it('keeps a published Doctor route resolvable with neutral subscription unavailability', async () => {
    prisma.doctorProfile.findUnique.mockResolvedValue(doctorProfile());
    subscriptionEntitlement.evaluateForFinancialAccount.mockResolvedValue({
      allowsNewSubscriptionGatedActivity: false,
    });

    const result = await service.getDoctorPublicRoute('doctor-public-id');

    expect(result.routeStatus).toBe('TEMPORARILY_UNAVAILABLE');
    expect(result.bookingEntryAllowed).toBe(false);
    expect(result.message).toBe(
      'Online booking is temporarily unavailable. Please try again later.',
    );
    expect(JSON.stringify(result)).not.toContain('SUSPENDED');
    expect(JSON.stringify(result)).not.toContain('billing');
  });

  it('uses the same neutral Doctor state for administrative restriction', async () => {
    const profile = doctorProfile();
    profile.user.administrativeRestrictionStatus = 'SUSPENDED';
    prisma.doctorProfile.findUnique.mockResolvedValue(profile);
    allowSubscription();

    const result = await service.getDoctorPublicRoute('doctor-public-id');

    expect(result.routeStatus).toBe('TEMPORARILY_UNAVAILABLE');
    expect(result.message).toBe(
      'Online booking is temporarily unavailable. Please try again later.',
    );
  });

  it('retires the Doctor public route after permanent account closure', async () => {
    const profile = doctorProfile();
    profile.user.accountStatus = 'PERMANENTLY_CLOSED';
    prisma.doctorProfile.findUnique.mockResolvedValue(profile);

    await expect(
      service.getDoctorPublicRoute('doctor-public-id'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(
      subscriptionEntitlement.evaluateForFinancialAccount,
    ).not.toHaveBeenCalled();
  });

  it('keeps a disabled PracticeLocation route resolvable but non-bookable', async () => {
    prisma.practiceLocation.findUnique.mockResolvedValue(
      locationRecord({ lifecycleStatus: 'DISABLED' }),
    );
    allowSubscription();

    const result = await service.getPracticeLocationPublicRoute(
      'location-public-id',
    );

    expect(result.routeStatus).toBe('TEMPORARILY_UNAVAILABLE');
    expect(result.bookingEntryAllowed).toBe(false);
    expect(result.services).toEqual([{ name: 'Consultation' }]);
    expect(result.message).toContain('currently unavailable');
  });

  it('retires a permanently deleted PracticeLocation route', async () => {
    prisma.practiceLocation.findUnique.mockResolvedValue(
      locationRecord({ lifecycleStatus: 'PERMANENTLY_DELETED' }),
    );

    await expect(
      service.getPracticeLocationPublicRoute('location-public-id'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('does not publish an explicitly unpublished Doctor profile', async () => {
    prisma.doctorProfile.findUnique.mockResolvedValue(
      doctorProfile({ isProfilePublic: false }),
    );

    await expect(
      service.getDoctorPublicRoute('doctor-public-id'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
