import type { ReactNode } from 'react';
import { formatQueueNumber } from '../presentation/queueNumber';

export type IndividualDuplicateContext = {
  kind: 'INDIVIDUAL';
  appointment: {
    bookingReference: string;
    queueNumber: number;
    serviceDate: string;
    firstName: string | null;
    lastName: string | null;
    practiceLocation: { name: string };
  };
};

export type GroupDuplicateContext = {
  kind: 'BOOKING_GROUP';
  bookingGroup: {
    id: string;
    serviceDate: string;
    practiceLocation: { name: string };
    appointments: Array<{
      bookingReference: string;
      queueNumber: number;
      firstName: string | null;
      lastName: string | null;
      status: string;
    }>;
  };
};

export type DuplicateContext = IndividualDuplicateContext | GroupDuplicateContext;

export type DuplicateContextResult =
  | { duplicate: false; replacementAuthorized: false }
  | { duplicate: true; replacementAuthorized: false; context: DuplicateContext };

export type UseExistingResult =
  | {
      contextKind: 'INDIVIDUAL';
      bookingReference: string;
      bookingAccessToken: { expiresAt: string; transport: 'HTTP_ONLY_COOKIE' };
    }
  | {
      contextKind: 'BOOKING_GROUP';
      bookingGroupId: string;
      bookingGroupAccessToken: { expiresAt: string; transport: 'HTTP_ONLY_COOKIE' };
    };

export function formatDuplicateServiceDate(value: string) {
  const [year, month, day] = value.slice(0, 10).split('-').map(Number);
  if (!year || !month || !day) return value;
  return new Intl.DateTimeFormat('en-PH', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

function patientName(firstName: string | null, lastName: string | null) {
  return [firstName, lastName].filter(Boolean).join(' ') || 'Patient';
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return <div><span>{label}</span><strong>{children}</strong></div>;
}

export function DuplicateBookingDecision({
  context,
  error,
  busy,
  onUseExisting,
  onNeedDifferent,
}: {
  context: DuplicateContext;
  error: string;
  busy: boolean;
  onUseExisting: () => void;
  onNeedDifferent: () => void;
}) {
  const clinicName = context.kind === 'INDIVIDUAL'
    ? context.appointment.practiceLocation.name
    : context.bookingGroup.practiceLocation.name;
  const serviceDate = context.kind === 'INDIVIDUAL'
    ? context.appointment.serviceDate
    : context.bookingGroup.serviceDate;

  return (
    <section className="booking-narrow" aria-labelledby="duplicate-booking-heading">
      <p className="eyebrow">Existing booking found</p>
      <h1 id="duplicate-booking-heading">Is this your booking?</h1>
      <div className="review-list">
        <Detail label="Clinic">{clinicName}</Detail>
        <Detail label="Service date">{formatDuplicateServiceDate(serviceDate)}</Detail>
        {context.kind === 'INDIVIDUAL' ? (
          <>
            <Detail label="Patient">{patientName(context.appointment.firstName, context.appointment.lastName)}</Detail>
            <Detail label="Booking reference">{context.appointment.bookingReference}</Detail>
            <Detail label="Queue Number">{formatQueueNumber(context.appointment.queueNumber)}</Detail>
          </>
        ) : (
          <Detail label="People">
            {context.bookingGroup.appointments.map((appointment) =>
              `${patientName(appointment.firstName, appointment.lastName)} · Queue ${formatQueueNumber(appointment.queueNumber)}`,
            ).join(', ')}
          </Detail>
        )}
      </div>
      {error ? <div className="form-error" role="alert">{error}</div> : null}
      <div className="form-actions stacked-actions">
        <button className="primary" type="button" disabled={busy} onClick={onUseExisting}>
          {busy ? 'Restoring access…' : 'Yes, this is my booking'}
        </button>
        <button className="secondary" type="button" disabled={busy} onClick={onNeedDifferent}>
          No, I need a different booking
        </button>
      </div>
    </section>
  );
}

export function DuplicateReplacementConfirmation({
  context,
  error,
  busy,
  onBack,
  onConfirmReplacement,
}: {
  context: DuplicateContext;
  error: string;
  busy: boolean;
  onBack: () => void;
  onConfirmReplacement: () => void;
}) {
  const clinicName = context.kind === 'INDIVIDUAL'
    ? context.appointment.practiceLocation.name
    : context.bookingGroup.practiceLocation.name;
  const serviceDate = context.kind === 'INDIVIDUAL'
    ? context.appointment.serviceDate
    : context.bookingGroup.serviceDate;

  return (
    <section className="booking-narrow" aria-labelledby="duplicate-replacement-heading">
      <p className="eyebrow">Replace existing booking</p>
      <h1 id="duplicate-replacement-heading">Cancel the existing booking and create a new one?</h1>
      <p>
        The existing booking at {clinicName} on {formatDuplicateServiceDate(serviceDate)} will be cancelled.
        Its old Queue Number and queue position will not transfer. The new booking will receive fresh Queue Number(s)
        when it is successfully confirmed.
      </p>
      {error ? <div className="form-error" role="alert">{error}</div> : null}
      <div className="form-actions stacked-actions">
        <button className="secondary" type="button" disabled={busy} onClick={onBack}>Keep existing booking</button>
        <button className="primary" type="button" disabled={busy} onClick={onConfirmReplacement}>
          {busy ? 'Cancelling…' : 'Cancel existing booking and create new one'}
        </button>
      </div>
    </section>
  );
}
