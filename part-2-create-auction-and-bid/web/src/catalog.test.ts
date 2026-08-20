import { describe, expect, it } from 'vitest';
import { formatCurrency, formatTimeLeft, parseDollarsToCents } from './catalog';

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

  it('parses dollar input into exact integer cents', () => {
    expect(parseDollarsToCents('1250')).toBe(125000);
    expect(parseDollarsToCents('1250.09')).toBe(125009);
    expect(parseDollarsToCents('12.999')).toBeNull();
  });
});
