import { describe, expect, it } from 'vitest';
import { formatQueueNumber } from './queueNumber';

describe('formatQueueNumber', () => {
  it('pads single-digit queue numbers and leaves larger numbers unchanged', () => {
    expect(formatQueueNumber(1)).toBe('01');
    expect(formatQueueNumber(9)).toBe('09');
    expect(formatQueueNumber(10)).toBe('10');
    expect(formatQueueNumber(123)).toBe('123');
  });
});
