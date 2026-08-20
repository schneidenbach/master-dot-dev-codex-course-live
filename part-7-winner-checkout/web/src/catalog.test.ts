import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BidConflictError,
  createBid,
  createCheckout,
  formatCurrency,
  formatTimeLeft,
  parseDollarsToCents,
} from './catalog';

afterEach(() => vi.unstubAllGlobals());

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

describe('bid API conflicts', () => {
  it('exposes structured stale-bid metadata to the UI', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      code: 'BID_TOO_LOW',
      error: 'Bid must be at least $1 above the current amount',
      currentPriceCents: 10_200,
      minimumBidCents: 10_300,
      endsAt: '2026-08-20T14:00:00.000Z',
    }), {
      status: 409,
      headers: { 'content-type': 'application/json' },
    })));

    const error = await createBid('test-auction', { userId: 2, amountCents: 10_200 })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(BidConflictError);
    expect(error).toMatchObject({
      code: 'BID_TOO_LOW',
      currentPriceCents: 10_200,
      minimumBidCents: 10_300,
      endsAt: '2026-08-20T14:00:00.000Z',
    });
  });
});

describe('checkout API', () => {
  it('sends only the selected user and accepts the server-owned checkout URL', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      role: 'winner',
      status: 'pending',
      purchaseId: '00000000-0000-4000-8000-000000000001',
      checkoutUrl: 'http://127.0.0.1:7107/checkout/cs_test_one',
    }), { status: 201, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    const checkout = await createCheckout('winner-server', 9);

    expect(checkout.checkoutUrl).toContain('/checkout/cs_test_one');
    expect(fetchMock).toHaveBeenCalledWith('/api/auctions/winner-server/checkout', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ userId: 9 }),
    }));
  });
});
