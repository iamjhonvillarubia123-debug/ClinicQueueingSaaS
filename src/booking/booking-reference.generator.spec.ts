import { BookingReferenceGenerator } from './booking-reference.generator';

describe('BookingReferenceGenerator', () => {
  let generator: BookingReferenceGenerator;

  beforeEach(() => {
    generator = new BookingReferenceGenerator();
  });

  it('should generate a booking reference in the expected format', () => {
    const reference = generator.generate();

    expect(reference).toMatch(
      /^CQ-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/,
    );
  });
});