import { ActiveBookingIdentityService } from './active-booking-identity.service';

describe('ActiveBookingIdentityService', () => {
  const service = new ActiveBookingIdentityService();
  const serviceDate = new Date('2026-08-20T00:00:00.000Z');

  it('derives stable 64-character draft and appointment keys', () => {
    const draftA = service.deriveDraftKey(
      'mobile-hash',
      'practice-1',
      serviceDate,
    );
    const draftB = service.deriveDraftKey(
      'mobile-hash',
      'practice-1',
      serviceDate,
    );
    const appointment = service.deriveAppointmentKey(
      'mobile-hash',
      'practice-1',
      serviceDate,
    );

    expect(draftA).toHaveLength(64);
    expect(draftA).toBe(draftB);
    expect(appointment).toHaveLength(64);
    expect(appointment).not.toBe(draftA);
  });

  it('changes identity when any approved duplicate-scope component changes', () => {
    const base = service.deriveAppointmentKey(
      'mobile-hash',
      'practice-1',
      serviceDate,
    );

    expect(
      service.deriveAppointmentKey('other-mobile', 'practice-1', serviceDate),
    ).not.toBe(base);
    expect(
      service.deriveAppointmentKey('mobile-hash', 'practice-2', serviceDate),
    ).not.toBe(base);
    expect(
      service.deriveAppointmentKey(
        'mobile-hash',
        'practice-1',
        new Date('2026-08-21T00:00:00.000Z'),
      ),
    ).not.toBe(base);
  });
});
