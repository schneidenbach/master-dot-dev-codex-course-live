import { createHmac, randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { closeDueAuctions } from './auctionClose.js';
import {
  type StripeCheckoutInput,
  type StripeCheckoutSession,
  StripeSessionNotFoundError,
} from './payments.js';

const connectionString = process.env.DATABASE_URL
  ?? 'postgres://auction:auction@localhost:55432/auction_part_7';
const title = 'Vitest replay safe winner checkout';
const recoveryTitle = 'Vitest missing Session recovery';
const secret = 'winner_checkout_test_secret';
const sessionInputs: StripeCheckoutInput[] = [];
const sessions = new Map<string, StripeCheckoutSession>();
const missingSessions = new Set<string>();
const unavailableSessions = new Set<string>();
const app = buildApp({
  stripeWebhookSecret: secret,
  webBaseUrl: 'http://marketplace.test',
  stripeClient: {
    async createCheckoutSession(input) {
      sessionInputs.push(input);
      const sessionId = `cs_test_${input.purchaseId.replaceAll('-', '')}_${sessionInputs.length}`;
      const session: StripeCheckoutSession = {
        id: sessionId,
        object: 'checkout.session',
        url: `http://stripe.test/checkout/${sessionId}`,
        status: 'open',
        payment_status: 'unpaid',
        client_reference_id: input.purchaseId,
      };
      sessions.set(session.id, session);
      return session;
    },
    async retrieveCheckoutSession(sessionId) {
      if (unavailableSessions.has(sessionId)) throw new Error('Mock Stripe unavailable');
      if (missingSessions.has(sessionId) || !sessions.has(sessionId)) {
        throw new StripeSessionNotFoundError(sessionId);
      }
      return sessions.get(sessionId)!;
    },
  },
});
let slug = '';

async function removeAuction() {
  const pool = new pg.Pool({ connectionString });
  try {
    await pool.query('DELETE FROM auctions WHERE title = ANY($1::text[])', [[title, recoveryTitle]]);
  } finally {
    await pool.end();
  }
}

beforeAll(async () => {
  await removeAuction();
  const created = await app.inject({
    method: 'POST',
    url: '/api/auctions',
    payload: {
      userId: 10,
      title,
      category: 'GPUs',
      description: 'A payment integration test auction with an authoritative winner.',
      condition: 'Bench tested',
      location: 'Chicago, IL',
      startingPriceCents: 50_000,
      endsAt: new Date(Date.now() + 120_000).toISOString(),
    },
  });
  slug = created.json().slug as string;
  const bid = await app.inject({
    method: 'POST',
    url: `/api/auctions/${slug}/bids`,
    payload: { userId: 9, amountCents: 50_100 },
  });
  expect(bid.statusCode).toBe(201);
  const pool = new pg.Pool({ connectionString });
  try {
    await closeDueAuctions({ pool, now: new Date(Date.now() + 180_000) });
  } finally {
    await pool.end();
  }
});

afterAll(async () => {
  await app.close();
  await removeAuction();
});

function signedEvent(overrides: Record<string, unknown> = {}) {
  const purchase = sessionInputs[0]!;
  const event = {
    eventId: randomUUID(),
    eventType: 'checkout.session.completed',
    occurredAt: new Date().toISOString(),
    data: {
      object: {
        id: [...sessions.values()].find((session) => session.client_reference_id === purchase.purchaseId)!.id,
        object: 'checkout.session',
        status: 'complete',
        payment_status: 'paid',
        client_reference_id: purchase.purchaseId,
        amount_total: 50_100,
        currency: 'usd',
        ...overrides,
      },
    },
  };
  const body = JSON.stringify(event);
  return {
    event,
    body,
    signature: createHmac('sha256', secret).update(body).digest('hex'),
  };
}

describe('winner checkout', () => {
  it('rejects non-winners and converges concurrent winner clicks on one Purchase and Session', async () => {
    const sellerState = await app.inject({
      method: 'GET', url: `/api/auctions/${slug}/checkout?userId=10`,
    });
    expect(sellerState.statusCode).toBe(200);
    expect(sellerState.json()).toEqual({ role: 'seller', status: 'awaiting_payment' });
    const unrelatedState = await app.inject({
      method: 'GET', url: `/api/auctions/${slug}/checkout?userId=8`,
    });
    expect(unrelatedState.statusCode).toBe(403);

    const denied = await app.inject({
      method: 'POST', url: `/api/auctions/${slug}/checkout`, payload: { userId: 8 },
    });
    expect(denied.statusCode).toBe(403);

    const [first, second] = await Promise.all([
      app.inject({ method: 'POST', url: `/api/auctions/${slug}/checkout`, payload: { userId: 9 } }),
      app.inject({ method: 'POST', url: `/api/auctions/${slug}/checkout`, payload: { userId: 9 } }),
    ]);
    expect([first.statusCode, second.statusCode].sort()).toEqual([200, 201]);
    expect(first.json().purchaseId).toBe(second.json().purchaseId);
    expect(first.json().checkoutUrl).toBe(second.json().checkoutUrl);
    expect(sessionInputs).toHaveLength(1);
    expect(sessionInputs[0]).toMatchObject({
      title,
      amountCents: 50_100,
      successUrl: expect.stringContaining(`items/${slug}?checkout=success`),
      cancelUrl: expect.stringContaining(`items/${slug}?checkout=canceled`),
    });

    const state = await app.inject({
      method: 'GET', url: `/api/auctions/${slug}/checkout?userId=9`,
    });
    expect(state.json()).toMatchObject({ role: 'winner', status: 'pending', amountCents: 50_100 });
  });

  it('trusts only a signed, matching webhook and handles duplicate completion idempotently', async () => {
    const completion = signedEvent();
    const forged = await app.inject({
      method: 'POST',
      url: '/api/webhooks/stripe',
      headers: { 'content-type': 'application/json', 'x-stripe-signature': '00' },
      payload: completion.body,
    });
    expect(forged.statusCode).toBe(400);

    const wrongAmount = signedEvent({ amount_total: 50_101 });
    const mismatch = await app.inject({
      method: 'POST',
      url: '/api/webhooks/stripe',
      headers: { 'content-type': 'application/json', 'x-stripe-signature': wrongAmount.signature },
      payload: wrongAmount.body,
    });
    expect(mismatch.statusCode).toBe(400);

    const accepted = await app.inject({
      method: 'POST',
      url: '/api/webhooks/stripe',
      headers: { 'content-type': 'application/json', 'x-stripe-signature': completion.signature },
      payload: completion.body,
    });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json()).toEqual({ received: true, duplicate: false });

    const duplicate = await app.inject({
      method: 'POST',
      url: '/api/webhooks/stripe',
      headers: { 'content-type': 'application/json', 'x-stripe-signature': completion.signature },
      payload: completion.body,
    });
    expect(duplicate.statusCode).toBe(200);
    expect(duplicate.json()).toEqual({ received: true, duplicate: true });

    const secondEvent = signedEvent();
    const sameSession = await app.inject({
      method: 'POST',
      url: '/api/webhooks/stripe',
      headers: { 'content-type': 'application/json', 'x-stripe-signature': secondEvent.signature },
      payload: secondEvent.body,
    });
    expect(sameSession.statusCode).toBe(200);
    expect(sameSession.json()).toEqual({ received: true, duplicate: true });

    const state = await app.inject({
      method: 'GET', url: `/api/auctions/${slug}/checkout?userId=9`,
    });
    expect(state.json()).toMatchObject({ status: 'paid', amountCents: 50_100 });
    const sellerState = await app.inject({
      method: 'GET', url: `/api/auctions/${slug}/checkout?userId=10`,
    });
    expect(sellerState.json()).toEqual({ role: 'seller', status: 'paid' });
    const repeatCheckout = await app.inject({
      method: 'POST', url: `/api/auctions/${slug}/checkout`, payload: { userId: 9 },
    });
    expect(repeatCheckout.statusCode).toBe(409);
    expect(repeatCheckout.json()).toMatchObject({ code: 'PURCHASE_PAID' });
  });

  it('replaces a missing provider Session without creating another Purchase or changing its amount', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/auctions',
      payload: {
        userId: 10,
        title: recoveryTitle,
        category: 'GPUs',
        description: 'An integration test auction for a missing in-memory provider Session.',
        condition: 'Bench tested',
        location: 'Chicago, IL',
        startingPriceCents: 60_000,
        endsAt: new Date(Date.now() + 120_000).toISOString(),
      },
    });
    const recoverySlug = created.json().slug as string;
    await app.inject({
      method: 'POST', url: `/api/auctions/${recoverySlug}/bids`,
      payload: { userId: 9, amountCents: 60_100 },
    });
    const pool = new pg.Pool({ connectionString });
    try {
      await closeDueAuctions({ pool, now: new Date(Date.now() + 180_000) });
    } finally {
      await pool.end();
    }

    const first = await app.inject({
      method: 'POST', url: `/api/auctions/${recoverySlug}/checkout`, payload: { userId: 9 },
    });
    expect(first.statusCode).toBe(201);
    const firstSessionId = first.json().checkoutUrl.split('/').at(-1)!;
    unavailableSessions.add(firstSessionId);
    const unavailable = await app.inject({
      method: 'POST', url: `/api/auctions/${recoverySlug}/checkout`, payload: { userId: 9 },
    });
    expect(unavailable.statusCode).toBe(503);
    unavailableSessions.delete(firstSessionId);
    missingSessions.add(firstSessionId);
    const replacement = await app.inject({
      method: 'POST', url: `/api/auctions/${recoverySlug}/checkout`, payload: { userId: 9 },
    });
    expect(replacement.statusCode).toBe(201);
    expect(replacement.json().purchaseId).toBe(first.json().purchaseId);
    expect(replacement.json().checkoutUrl).not.toBe(first.json().checkoutUrl);
    expect(sessionInputs.at(-1)).toMatchObject({ amountCents: 60_100 });

    const verifyPool = new pg.Pool({ connectionString });
    try {
      const stored = await verifyPool.query<{
        purchase_count: number;
        amount_cents: number;
      }>(
        `SELECT count(*)::int AS purchase_count, max(purchase.amount_cents)::int AS amount_cents
         FROM purchases purchase JOIN auctions auction ON auction.id = purchase.auction_id
         WHERE auction.slug = $1`,
        [recoverySlug],
      );
      expect(stored.rows[0]).toMatchObject({ purchase_count: 1, amount_cents: 60_100 });
    } finally {
      await verifyPool.end();
    }
  });
});
