import { describe, expect, it } from 'vitest';
import { formatQueueNumber } from './queueNumber';

describe('formatQueueNumber', () => {
  it('pads queue numbers to the approved three-digit patient display and leaves larger numbers unchanged', () => {
    expect(formatQueueNumber(1)).toBe('001');
    expect(formatQueueNumber(9)).toBe('009');
    expect(formatQueueNumber(10)).toBe('010');
    expect(formatQueueNumber(23)).toBe('023');
    expect(formatQueueNumber(123)).toBe('123');
    expect(formatQueueNumber(1234)).toBe('1234');
  });
});
