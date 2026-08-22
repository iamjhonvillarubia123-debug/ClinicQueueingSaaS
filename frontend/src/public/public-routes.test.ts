import { describe, expect, it } from 'vitest';
import { publicBookingPath, publicDoctorPath, publicPracticeLocationPath } from './public-routes';

describe('stable public path helpers', () => {
  it('encodes opaque public identifiers without treating them as credentials', () => {
    expect(publicDoctorPath('doctor/id')).toBe('/public/doctors/doctor%2Fid');
    expect(publicPracticeLocationPath('clinic id')).toBe('/public/practice-locations/clinic%20id');
    expect(publicBookingPath('clinic id')).toBe('/book/clinic%20id');
  });
});
