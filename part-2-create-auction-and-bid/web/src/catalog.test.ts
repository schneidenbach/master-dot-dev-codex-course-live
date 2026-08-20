import { describe, expect, it } from 'vitest';
import { formatCurrency, formatTimeLeft } from './catalog';

describe('catalog formatting', () => {
  it('formats integer cents without losing fractional bids', () => {
    expect(formatCurrency(1845000)).toBe('$18,450');
    expect(formatCurrency(1845099)).toBe('$18,450.99');
  });

  it('formats time remaining and ended auctions', () => {
    const now = Date.parse('2026-08-20T12:00:00.000Z');
    expect(formatTimeLeft('2026-08-20T14:14:00.000Z', now)).toBe('2h 14m');
    expect(formatTimeLeft('2026-08-20T11:59:00.000Z', now)).toBe('Ended');
  });
});
