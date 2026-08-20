import { Injectable, NotFoundException } from '@nestjs/common';
import { SubscriptionEntitlementService } from '../financial/subscription-entitlement.service';
import { PrismaService } from '../prisma/prisma.service';

export type PublicRouteStatus = 'AVAILABLE' | 'TEMPORARILY_UNAVAILABLE' | 'NO_BOOKING_LOCATIONS';

type PublicDoctorIdentity = {
  publicIdentifier: string;
  publicSlug: string | null;
  firstName: string;
  middleName: string | null;
  lastName: string;
  suffix: string | null;
  professionalTitle: string;
  specialization: string;
  profileDescription: string | null;
  profilePhotoUrl: string | null;
};

@Injectable()
export class PublicRoutingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly subscriptionEntitlement: SubscriptionEntitlementService,
  ) {}

  async getDoctorPublicRoute(publicIdentifier: string, now = new Date()) {
    const normalizedIdentifier = this.normalizeIdentifier(publicIdentifier);
    const profile = await this.prisma.doctorProfile.findUnique({
      where: { publicIdentifier: normalizedIdentifier },
      select: {
        publicIdentifier: true,
        publicSlug: true,
        isProfilePublic: true,
        middleName: true,
        suffix: true,
        professionalTitle: true,
        specialization: true,
        profileDescription: true,
        profilePhotoUrl: true,
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            accountStatus: true,
            administrativeRestrictionStatus: true,
            doctorFinancialAccount: { select: { id: true } },
          },
        },
        practiceLocations: {
          select: {
            publicIdentifier: true,
            lifecycleStatus: true,
            isBookingEnabled: true,
            name: true,
            cityMunicipality: true,
            province: true,
          },
          orderBy: [{ name: 'asc' }, { publicIdentifier: 'asc' }],
        },
      },
    });

    if (!profile || !profile.isProfilePublic) this.notFound();
    if (profile.user.accountStatus === 'PERMANENTLY_CLOSED') this.notFound();

    const subscriptionAllowsBooking = await this.subscriptionAllowsBooking(
      profile.user.doctorFinancialAccount?.id,
      now,
    );
    const doctorAllowsBooking =
      profile.user.accountStatus === 'ACTIVE' &&
      profile.user.administrativeRestrictionStatus === 'NONE' &&
      subscriptionAllowsBooking;

    const visibleLocations = profile.practiceLocations
      .filter((location) => location.lifecycleStatus === 'ACTIVE')
      .map((location) => ({
        publicIdentifier: location.publicIdentifier,
        name: location.name,
        cityMunicipality: location.cityMunicipality,
        province: location.province,
        bookingEntryAllowed:
          doctorAllowsBooking && location.isBookingEnabled === true,
      }));

    const bookableLocationCount = visibleLocations.filter(
      (location) => location.bookingEntryAllowed,
    ).length;

    let routeStatus: PublicRouteStatus;
    let message: string | null = null;
    if (!doctorAllowsBooking) {
      routeStatus = 'TEMPORARILY_UNAVAILABLE';
      message =
        'Online booking is temporarily unavailable. Please try again later.';
    } else if (bookableLocationCount === 0) {
      routeStatus = 'NO_BOOKING_LOCATIONS';
      message =
        'No practice locations are currently available for online booking.';
    } else {
      routeStatus = 'AVAILABLE';
    }

    return {
      publicIdentifier: profile.publicIdentifier,
      publicSlug: profile.publicSlug,
      routeStatus,
      message,
      bookingEntryAllowed: routeStatus === 'AVAILABLE',
      doctor: this.mapDoctorIdentity(profile),
      practiceLocations: visibleLocations,
    };
  }

  async getPracticeLocationPublicRoute(
    publicIdentifier: string,
    now = new Date(),
  ) {
    const normalizedIdentifier = this.normalizeIdentifier(publicIdentifier);
    const location = await this.prisma.practiceLocation.findUnique({
      where: { publicIdentifier: normalizedIdentifier },
      select: {
        publicIdentifier: true,
        lifecycleStatus: true,
        isBookingEnabled: true,
        name: true,
        addressLine1: true,
        addressLine2: true,
        cityMunicipality: true,
        province: true,
        postalCode: true,
        countryCode: true,
        timeZone: true,
        doctorProfile: {
          select: {
            publicIdentifier: true,
            publicSlug: true,
            middleName: true,
            suffix: true,
            professionalTitle: true,
            specialization: true,
            profileDescription: true,
            profilePhotoUrl: true,
            user: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                accountStatus: true,
                administrativeRestrictionStatus: true,
                doctorFinancialAccount: { select: { id: true } },
              },
            },
          },
        },
        services: {
          where: { status: 'ACTIVE' },
          select: { name: true },
          orderBy: [{ name: 'asc' }, { id: 'asc' }],
        },
      },
    });

    if (!location) this.notFound();
    if (location.lifecycleStatus === 'PERMANENTLY_DELETED') this.notFound();
    if (location.doctorProfile.user.accountStatus === 'PERMANENTLY_CLOSED') {
      this.notFound();
    }

    const subscriptionAllowsBooking = await this.subscriptionAllowsBooking(
      location.doctorProfile.user.doctorFinancialAccount?.id,
      now,
    );
    const doctorAllowsBooking =
      location.doctorProfile.user.accountStatus === 'ACTIVE' &&
      location.doctorProfile.user.administrativeRestrictionStatus === 'NONE' &&
      subscriptionAllowsBooking;
    const locationAllowsBooking =
      location.lifecycleStatus === 'ACTIVE' &&
      location.isBookingEnabled === true;
    const bookingEntryAllowed = doctorAllowsBooking && locationAllowsBooking;

    const routeStatus: PublicRouteStatus = bookingEntryAllowed
      ? 'AVAILABLE'
      : 'TEMPORARILY_UNAVAILABLE';
    const message = bookingEntryAllowed
      ? null
      : location.lifecycleStatus === 'DISABLED'
        ? 'This practice location is currently unavailable. View other practice locations for this doctor.'
        : 'Online booking is temporarily unavailable. Please try again later.';

    return {
      publicIdentifier: location.publicIdentifier,
      routeStatus,
      message,
      bookingEntryAllowed,
      doctor: this.mapDoctorIdentity(location.doctorProfile),
      practiceLocation: {
        name: location.name,
        addressLine1: location.addressLine1,
        addressLine2: location.addressLine2,
        cityMunicipality: location.cityMunicipality,
        province: location.province,
        postalCode: location.postalCode,
        countryCode: location.countryCode,
        timeZone: location.timeZone,
      },
      services: location.services,
    };
  }

  private async subscriptionAllowsBooking(
    doctorFinancialAccountId: string | undefined,
    now: Date,
  ): Promise<boolean> {
    if (!doctorFinancialAccountId) return false;
    const evaluation =
      await this.subscriptionEntitlement.evaluateForFinancialAccount(
        doctorFinancialAccountId,
        now,
      );
    return evaluation.allowsNewSubscriptionGatedActivity;
  }

  private mapDoctorIdentity(profile: {
    publicIdentifier: string;
    publicSlug: string | null;
    middleName: string | null;
    suffix: string | null;
    professionalTitle: string;
    specialization: string;
    profileDescription: string | null;
    profilePhotoUrl: string | null;
    user: { firstName: string; lastName: string };
  }): PublicDoctorIdentity {
    return {
      publicIdentifier: profile.publicIdentifier,
      publicSlug: profile.publicSlug,
      firstName: profile.user.firstName,
      middleName: profile.middleName,
      lastName: profile.user.lastName,
      suffix: profile.suffix,
      professionalTitle: profile.professionalTitle,
      specialization: profile.specialization,
      profileDescription: profile.profileDescription,
      profilePhotoUrl: profile.profilePhotoUrl,
    };
  }

  private normalizeIdentifier(publicIdentifier: string): string {
    const normalized = publicIdentifier.trim();
    if (!normalized || normalized.length > 64) this.notFound();
    return normalized;
  }

  private notFound(): never {
    throw new NotFoundException('Public route not found.');
  }
}
