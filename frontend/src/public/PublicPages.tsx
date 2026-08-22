import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ApiError, apiRequest } from '../api/client';

type PublicRouteStatus = 'AVAILABLE' | 'TEMPORARILY_UNAVAILABLE' | 'NO_BOOKING_LOCATIONS';

type DoctorIdentity = {
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

type DoctorLocation = {
  publicIdentifier: string;
  publicUrl: string;
  name: string;
  cityMunicipality: string;
  province: string;
  bookingEntryAllowed: boolean;
};

type DoctorRoute = {
  routeStatus: PublicRouteStatus;
  message: string | null;
  bookingEntryAllowed: boolean;
  doctor: DoctorIdentity;
  practiceLocations: DoctorLocation[];
};

type PracticeLocationRoute = {
  routeStatus: PublicRouteStatus;
  message: string | null;
  bookingEntryAllowed: boolean;
  doctor: DoctorIdentity;
  practiceLocation: {
    name: string;
    addressLine1: string;
    addressLine2: string | null;
    cityMunicipality: string;
    province: string;
    postalCode: string | null;
    countryCode: string;
    timeZone: string;
  };
  services: Array<{ name: string }>;
};

function usePublicResource<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'not-found' | 'error'>('loading');

  useEffect(() => {
    let active = true;
    if (!path) {
      setState('not-found');
      return () => { active = false; };
    }

    setState('loading');
    void apiRequest<T>(path)
      .then((result) => {
        if (!active) return;
        setData(result);
        setState('ready');
      })
      .catch((error: unknown) => {
        if (!active) return;
        setData(null);
        setState(error instanceof ApiError && error.status === 404 ? 'not-found' : 'error');
      });

    return () => { active = false; };
  }, [path]);

  return { data, state };
}

function PublicHeader() {
  return (
    <header className="public-header">
      <Link className="brand" to="/">Clinic Queueing</Link>
      <Link className="quiet-link" to="/login">Staff sign in</Link>
    </header>
  );
}

function ResourceState({ state }: { state: 'loading' | 'not-found' | 'error' }) {
  if (state === 'loading') {
    return <main className="public-detail"><PublicHeader /><section className="public-state" aria-live="polite"><p className="eyebrow">Loading</p><h1>Getting the clinic ready…</h1></section></main>;
  }

  const notFound = state === 'not-found';
  return (
    <main className="public-detail">
      <PublicHeader />
      <section className="public-state">
        <p className="eyebrow">{notFound ? 'Unavailable' : 'Connection problem'}</p>
        <h1>{notFound ? 'This public page is no longer available.' : 'We could not load this page.'}</h1>
        <p>{notFound ? 'The link may have been retired or entered incorrectly.' : 'Please check your connection and try again.'}</p>
        <Link className="secondary-action" to="/">Return home</Link>
      </section>
    </main>
  );
}

function doctorName(doctor: DoctorIdentity) {
  return [doctor.professionalTitle, doctor.firstName, doctor.middleName, doctor.lastName, doctor.suffix]
    .filter(Boolean)
    .join(' ');
}

function DoctorIntro({ doctor }: { doctor: DoctorIdentity }) {
  return (
    <div className="doctor-intro">
      {doctor.profilePhotoUrl ? <img className="doctor-photo" src={doctor.profilePhotoUrl} alt="" /> : null}
      <div>
        <p className="eyebrow">Doctor profile</p>
        <h1>{doctorName(doctor)}</h1>
        <p className="specialization">{doctor.specialization}</p>
      </div>
    </div>
  );
}

function AvailabilityNotice({ status, message }: { status: PublicRouteStatus; message: string | null }) {
  if (status === 'AVAILABLE' || !message) return null;
  return <div className="availability-notice" role="status"><strong>Online booking unavailable</strong><span>{message}</span></div>;
}

export function DoctorPublicPage() {
  const { publicIdentifier } = useParams();
  const path = publicIdentifier ? `/public/doctors/${encodeURIComponent(publicIdentifier)}` : null;
  const { data, state } = usePublicResource<DoctorRoute>(path);

  if (state !== 'ready' || !data) return <ResourceState state={state === 'ready' ? 'error' : state} />;

  if (data.routeStatus === 'TEMPORARILY_UNAVAILABLE') {
    return (
      <main className="public-detail">
        <PublicHeader />
        <section className="public-state">
          <p className="eyebrow">Online booking</p>
          <h1>Online booking is temporarily unavailable.</h1>
          <p>{data.message ?? 'Please try again later.'}</p>
        </section>
      </main>
    );
  }

  return (
    <main className="public-detail">
      <PublicHeader />
      <article className="public-content">
        <DoctorIntro doctor={data.doctor} />
        {data.doctor.profileDescription ? <p className="profile-description">{data.doctor.profileDescription}</p> : null}
        <AvailabilityNotice status={data.routeStatus} message={data.message} />

        <section className="public-section" aria-labelledby="locations-heading">
          <div className="section-heading">
            <p className="eyebrow">Practice locations</p>
            <h2 id="locations-heading">Choose a clinic</h2>
            <p>Select a location to view clinic details and continue toward booking.</p>
          </div>

          {data.practiceLocations.length ? (
            <div className="location-list">
              {data.practiceLocations.map((location) => (
                <article className="location-row" key={location.publicIdentifier}>
                  <div>
                    <h3>{location.name}</h3>
                    <p>{location.cityMunicipality}, {location.province}</p>
                  </div>
                  <Link className="secondary-action" to={`/public/practice-locations/${encodeURIComponent(location.publicIdentifier)}`}>
                    View clinic
                  </Link>
                </article>
              ))}
            </div>
          ) : <p className="empty-copy">No practice locations are currently available for online booking.</p>}
        </section>
      </article>
    </main>
  );
}

function formatAddress(location: PracticeLocationRoute['practiceLocation']) {
  return [location.addressLine1, location.addressLine2, location.cityMunicipality, location.province, location.postalCode]
    .filter(Boolean)
    .join(', ');
}

export function PracticeLocationPublicPage() {
  const { publicIdentifier } = useParams();
  const path = publicIdentifier ? `/public/practice-locations/${encodeURIComponent(publicIdentifier)}` : null;
  const { data, state } = usePublicResource<PracticeLocationRoute>(path);

  if (state !== 'ready' || !data || !publicIdentifier) return <ResourceState state={state === 'ready' ? 'error' : state} />;

  return (
    <main className="public-detail">
      <PublicHeader />
      <article className="public-content location-page">
        <Link className="back-link" to={`/public/doctors/${encodeURIComponent(data.doctor.publicIdentifier)}`}>← View doctor and other locations</Link>
        <div className="location-hero">
          <p className="eyebrow">Practice location</p>
          <h1>{data.practiceLocation.name}</h1>
          <p className="location-address">{formatAddress(data.practiceLocation)}</p>
          <p className="doctor-byline">{doctorName(data.doctor)} · {data.doctor.specialization}</p>
        </div>

        <AvailabilityNotice status={data.routeStatus} message={data.message} />

        {data.bookingEntryAllowed ? (
          <div className="booking-entry">
            <div><strong>Ready to book?</strong><span>Choose one person or a group of 2–5 people.</span></div>
            <div className="booking-entry-actions">
              <Link className="primary-action" to={`/book/${encodeURIComponent(publicIdentifier)}`}>Book one person</Link>
              <Link className="secondary-action" to={`/book/${encodeURIComponent(publicIdentifier)}/group`}>Book multiple people</Link>
            </div>
          </div>
        ) : null}

        <section className="public-section" aria-labelledby="services-heading">
          <div className="section-heading">
            <p className="eyebrow">Services</p>
            <h2 id="services-heading">Services at this clinic</h2>
            <p>Service listing does not guarantee availability on a particular date.</p>
          </div>
          {data.services.length ? <ul className="service-list">{data.services.map((service) => <li key={service.name}>{service.name}</li>)}</ul> : <p className="empty-copy">No public services are listed for this location.</p>}
        </section>
      </article>
    </main>
  );
}

export function BookingEntryBoundary() {
  const { publicIdentifier } = useParams();
  const target = useMemo(() => publicIdentifier ? `/public/practice-locations/${encodeURIComponent(publicIdentifier)}` : '/', [publicIdentifier]);
  return (
    <main className="public-detail">
      <PublicHeader />
      <section className="public-state">
        <p className="eyebrow">Booking</p>
        <h1>Your clinic is selected.</h1>
        <p>The next step is choosing an available service date.</p>
        <Link className="secondary-action" to={target}>Back to clinic</Link>
      </section>
    </main>
  );
}
