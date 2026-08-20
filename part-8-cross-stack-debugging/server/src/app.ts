import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import pg from 'pg';
import { z } from 'zod';
import type { AuctionChangedEvent } from './realtime.js';
import {
  createMockStripeClient,
  type StripeClient,
  StripeSessionNotFoundError,
  stripeWebhookEventSchema,
  verifyStripeSignature,
} from './payments.js';
import {
  activeTraceparent,
  contextFromHeaders,
  contextFromTraceparent,
  withBusinessSpan,
} from './tracing.js';

const connectionString = process.env.DATABASE_URL ?? 'postgres://auction:auction@localhost:55432/auction_part_8';

const listQuerySchema = z.object({ q: z.string().trim().max(100).optional() });
const slugParamsSchema = z.object({ slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/) });
const categorySchema = z.enum(['GPUs', 'CPUs', 'Memory', 'Chassis', 'Networking', 'Cooling']);
const createAuctionSchema = z.object({
  userId: z.number().int().positive(),
  title: z.string().trim().min(3).max(120),
  category: categorySchema,
  description: z.string().trim().min(10).max(4000),
  condition: z.string().trim().min(2).max(100),
  location: z.string().trim().min(2).max(100),
  startingPriceCents: z.number().int().positive().max(1_000_000_000),
  endsAt: z.string().datetime({ offset: true }),
});
const createBidSchema = z.object({
  userId: z.number().int().positive(),
  amountCents: z.number().int().positive().max(1_000_000_000),
});
const checkoutBodySchema = z.object({ userId: z.number().int().positive() });
const checkoutQuerySchema = z.object({ userId: z.coerce.number().int().positive() });

const artByCategory = {
  GPUs: 'gpu',
  CPUs: 'cpu',
  Memory: 'memory',
  Chassis: 'chassis',
  Networking: 'switch',
  Cooling: 'cooling',
} as const;

function slugify(title: string): string {
  return title.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'auction';
}

type AuctionRow = {
  slug: string;
  title: string;
  kicker: string;
  category: string;
  art: string;
  current_price_cents: number;
  bid_count: number;
  current_bidder: string | null;
  ends_at: Date;
  closed_at: Date | null;
  winning_bid_id: string | null;
  winning_bid_amount_cents: number | null;
  winning_bid_created_at: Date | null;
  winning_bidder_id: number | null;
  winning_bidder_display_name: string | null;
  winning_bidder_handle: string | null;
  seller_id: number;
  seller_display_name: string;
  seller_handle: string;
  location: string;
  condition: string;
  description: string;
  specs: Array<[string, string]>;
};

type BidRow = {
  id: string;
  amount_cents: number;
  created_at: Date;
  bidder_id: number;
  bidder_display_name: string;
  bidder_handle: string;
};

function toBid(row: BidRow) {
  return {
    id: row.id,
    amountCents: row.amount_cents,
    createdAt: row.created_at.toISOString(),
    bidder: {
      id: row.bidder_id,
      displayName: row.bidder_display_name,
      handle: row.bidder_handle,
    },
  };
}

const auctionSelect = `
  SELECT a.slug, a.title, a.kicker, a.category, a.art,
    COALESCE(top_bid.amount_cents, a.starting_price_cents)::int AS current_price_cents,
    COALESCE(bid_totals.bid_count, 0)::int AS bid_count,
    top_bid.bidder_handle AS current_bidder,
    a.ends_at, close.closed_at,
    winning_bid.id::text AS winning_bid_id,
    winning_bid.amount_cents AS winning_bid_amount_cents,
    winning_bid.created_at AS winning_bid_created_at,
    winner.id AS winning_bidder_id,
    winner.display_name AS winning_bidder_display_name,
    winner.handle AS winning_bidder_handle,
    a.location, a.condition, a.description, a.specs,
    seller.id AS seller_id, seller.display_name AS seller_display_name,
    seller.handle AS seller_handle
  FROM auctions a
  JOIN users seller ON seller.id = a.seller_user_id
  LEFT JOIN auction_closes close ON close.auction_id = a.id
  LEFT JOIN bids winning_bid ON winning_bid.id = close.winning_bid_id
  LEFT JOIN users winner ON winner.id = winning_bid.bidder_user_id
  LEFT JOIN LATERAL (
    SELECT b.amount_cents, bidder.handle AS bidder_handle
    FROM bids b
    JOIN users bidder ON bidder.id = b.bidder_user_id
    WHERE b.auction_id = a.id
    ORDER BY b.amount_cents DESC, b.created_at ASC, b.id ASC
    LIMIT 1
  ) top_bid ON true
  LEFT JOIN LATERAL (
    SELECT count(*)::int AS bid_count FROM bids b WHERE b.auction_id = a.id
  ) bid_totals ON true`;

function toAuction(row: AuctionRow) {
  return {
    slug: row.slug,
    title: row.title,
    kicker: row.kicker,
    category: row.category,
    art: row.art,
    currentPriceCents: row.current_price_cents,
    bidCount: row.bid_count,
    currentBidder: row.current_bidder,
    endsAt: row.ends_at.toISOString(),
    closedAt: row.closed_at?.toISOString() ?? null,
    winningBid: row.winning_bid_id && row.winning_bid_amount_cents !== null
      && row.winning_bid_created_at && row.winning_bidder_id !== null
      && row.winning_bidder_display_name && row.winning_bidder_handle ? {
        id: row.winning_bid_id,
        amountCents: row.winning_bid_amount_cents,
        createdAt: row.winning_bid_created_at.toISOString(),
        bidder: {
          id: row.winning_bidder_id,
          displayName: row.winning_bidder_display_name,
          handle: row.winning_bidder_handle,
        },
      } : null,
    seller: {
      id: row.seller_id,
      displayName: row.seller_display_name,
      handle: row.seller_handle,
    },
    location: row.location,
    condition: row.condition,
    description: row.description,
    specs: row.specs,
  };
}

export type Clock = {
  now(): Date;
};

const systemClock: Clock = {
  now: () => new Date(),
};

export function buildApp({
  clock = systemClock,
  publishAuctionChanged = () => undefined,
  stripeClient = createMockStripeClient(),
  webBaseUrl = process.env.WEB_PUBLIC_URL ?? 'http://localhost:5108',
  stripeWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET ?? 'whsec_local_part_8',
}: {
  clock?: Clock;
  publishAuctionChanged?: (event: AuctionChangedEvent) => void;
  stripeClient?: StripeClient;
  webBaseUrl?: string;
  stripeWebhookSecret?: string;
} = {}) {
  const app = Fastify({ logger: true, requestIdHeader: 'x-request-id' });
  const pool = new pg.Pool({ connectionString, connectionTimeoutMillis: 1000 });

  app.addHook('onRequest', async (request, reply) => {
    reply.header('x-request-id', request.id);
  });

  app.get('/api/health', async (request, reply) => {
    try {
      await pool.query('SELECT 1');
      return { ok: true, db: 'ok', requestId: request.id };
    } catch (error) {
      request.log.error({ err: error }, 'database health check failed');
      return reply.code(503).send({ ok: false, db: 'down', requestId: request.id });
    }
  });

  app.get('/api/users', async () => {
    const result = await pool.query<{ id: number; display_name: string; handle: string }>(
      'SELECT id, display_name, handle FROM users ORDER BY id',
    );
    return result.rows.map((user) => ({
      id: user.id,
      displayName: user.display_name,
      handle: user.handle,
    }));
  });

  app.get('/api/auctions', async (request, reply) => {
    const parsed = listQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid auction search query' });
    }

    const query = parsed.data.q ?? '';
    const result = await pool.query<AuctionRow>(
      `${auctionSelect}
       WHERE $1 = '' OR concat_ws(' ', a.title, a.kicker, a.category) ILIKE '%' || $1 || '%'
       ORDER BY a.ends_at ASC, a.id ASC`,
      [query],
    );
    return result.rows.map(toAuction);
  });

  app.get('/api/auctions/:slug', async (request, reply) => {
    const parsed = slugParamsSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid auction slug' });
    }

    const result = await pool.query<AuctionRow>(
      `${auctionSelect} WHERE a.slug = $1`,
      [parsed.data.slug],
    );
    if (!result.rows[0]) {
      return reply.code(404).send({ error: 'Auction not found' });
    }
    const bids = await pool.query<BidRow>(
      `SELECT b.id::text, b.amount_cents, b.created_at,
         bidder.id AS bidder_id, bidder.display_name AS bidder_display_name,
         bidder.handle AS bidder_handle
       FROM bids b
       JOIN users bidder ON bidder.id = b.bidder_user_id
       JOIN auctions a ON a.id = b.auction_id
       WHERE a.slug = $1
       ORDER BY b.created_at DESC, b.id DESC`,
      [parsed.data.slug],
    );
    return { ...toAuction(result.rows[0]), bidHistory: bids.rows.map(toBid) };
  });

  app.get('/api/auctions/:slug/checkout', async (request, reply) => {
    const params = slugParamsSchema.safeParse(request.params);
    const query = checkoutQuerySchema.safeParse(request.query);
    if (!params.success || !query.success) {
      return reply.code(400).send({ error: 'Invalid checkout request' });
    }
    const result = await pool.query<{
      id: string | null;
      amount_cents: number;
      status: 'pending' | 'paid' | null;
      seller_user_id: number;
      winning_bidder_user_id: number;
    }>(
      `SELECT purchase.id::text, winning_bid.amount_cents, purchase.status,
         auction.seller_user_id, winning_bid.bidder_user_id AS winning_bidder_user_id
       FROM auctions auction
       JOIN auction_closes close ON close.auction_id = auction.id
       JOIN bids winning_bid ON winning_bid.id = close.winning_bid_id
       LEFT JOIN purchases purchase ON purchase.auction_id = auction.id
       WHERE auction.slug = $1`,
      [params.data.slug],
    );
    const purchase = result.rows[0];
    if (!purchase) return reply.code(403).send({ error: 'Payment status is unavailable' });
    if (purchase.seller_user_id === query.data.userId) {
      return {
        role: 'seller',
        status: purchase.status === 'paid' ? 'paid' : 'awaiting_payment',
      };
    }
    if (purchase.winning_bidder_user_id !== query.data.userId) {
      return reply.code(403).send({ error: 'Payment status is unavailable' });
    }
    return {
      role: 'winner',
      status: purchase.status ?? 'required',
      amountCents: purchase.amount_cents,
      purchaseId: purchase.id,
    };
  });

  app.post('/api/auctions/:slug/checkout', async (request, reply) => {
    const params = slugParamsSchema.safeParse(request.params);
    const body = checkoutBodySchema.safeParse(request.body);
    if (!params.success || !body.success) {
      return reply.code(400).send({ error: 'Invalid checkout request' });
    }

    const lifecycle = await pool.query<{ auction_id: string; traceparent: string | null }>(
      `SELECT auction.id::text AS auction_id, close.traceparent
       FROM auctions auction
       JOIN auction_closes close ON close.auction_id = auction.id
       WHERE auction.slug = $1`,
      [params.data.slug],
    );
    return withBusinessSpan('winner.checkout.start', {
      'auction.slug': params.data.slug,
      'auction.id': lifecycle.rows[0]?.auction_id ?? 'unknown',
      'auction.winning_bidder_user.id': body.data.userId,
    }, async (span) => {

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const eligible = await client.query<{
        auction_id: string;
        title: string;
        winning_bidder_user_id: number;
        amount_cents: number;
      }>(
        `SELECT auction.id::text AS auction_id, auction.title,
           winning_bid.bidder_user_id AS winning_bidder_user_id,
           winning_bid.amount_cents
         FROM auctions auction
         JOIN auction_closes close ON close.auction_id = auction.id
         JOIN bids winning_bid ON winning_bid.id = close.winning_bid_id
         WHERE auction.slug = $1
         FOR UPDATE OF auction`,
        [params.data.slug],
      );
      const auction = eligible.rows[0];
      if (!auction || auction.winning_bidder_user_id !== body.data.userId) {
        await client.query('ROLLBACK');
        span.setAttribute('winner.checkout.outcome', 'not_eligible');
        return reply.code(403).send({ error: 'Checkout is available only to the winning bidder' });
      }

      const purchaseId = randomUUID();
      await client.query(
        `INSERT INTO purchases (
           id, auction_id, winning_bidder_user_id, amount_cents, currency, created_at
         ) VALUES ($1, $2, $3, $4, 'usd', $5)
         ON CONFLICT (auction_id) DO NOTHING`,
        [purchaseId, auction.auction_id, auction.winning_bidder_user_id, auction.amount_cents, clock.now()],
      );
      const stored = await client.query<{
        id: string;
        status: 'pending' | 'paid';
        provider_session_id: string | null;
        provider_checkout_url: string | null;
      }>(
        `SELECT id::text, status, provider_session_id, provider_checkout_url
         FROM purchases WHERE auction_id = $1 FOR UPDATE`,
        [auction.auction_id],
      );
      const purchase = stored.rows[0];
      span.setAttributes({
        'purchase.id': purchase.id,
        'purchase.amount_cents': auction.amount_cents,
      });
      if (purchase.status === 'paid') {
        await client.query('COMMIT');
        span.setAttribute('winner.checkout.outcome', 'already_paid');
        return reply.code(409).send({ code: 'PURCHASE_PAID', error: 'This purchase is already paid' });
      }
      if (purchase.provider_session_id && purchase.provider_checkout_url) {
        try {
          const existing = await stripeClient.retrieveCheckoutSession(purchase.provider_session_id);
          if (existing.client_reference_id !== purchase.id) {
            throw new Error('Mock Stripe returned a Session for another Purchase');
          }
          await client.query('COMMIT');
          span.setAttributes({
            'winner.checkout.outcome': 'existing_session',
            'payment.session.id': existing.id,
          });
          return { status: 'pending', purchaseId: purchase.id, checkoutUrl: existing.url };
        } catch (error) {
          if (!(error instanceof StripeSessionNotFoundError)) throw error;
          request.log.warn({ sessionId: purchase.provider_session_id }, 'replacing missing unpaid Checkout Session');
        }
      }

      const itemUrl = `${webBaseUrl}/items/${encodeURIComponent(params.data.slug)}`;
      const session = await stripeClient.createCheckoutSession({
        purchaseId: purchase.id,
        title: auction.title,
        amountCents: auction.amount_cents,
        successUrl: `${itemUrl}?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
        cancelUrl: `${itemUrl}?checkout=canceled`,
      });
      if (session.client_reference_id !== purchase.id || session.status !== 'open' || session.payment_status !== 'unpaid') {
        throw new Error('Mock Stripe returned a mismatched Checkout Session');
      }
      await client.query(
        `UPDATE purchases SET provider_session_id = $2, provider_checkout_url = $3
         WHERE id = $1`,
        [purchase.id, session.id, session.url],
      );
      await client.query('COMMIT');
      span.setAttributes({
        'winner.checkout.outcome': 'session_created',
        'payment.session.id': session.id,
      });
      return reply.code(201).send({ status: 'pending', purchaseId: purchase.id, checkoutUrl: session.url });
    } catch (error) {
      await client.query('ROLLBACK');
      request.log.error({ err: error, slug: params.data.slug }, 'checkout creation failed');
      return reply.code(503).send({ error: 'Checkout is temporarily unavailable. Please try again.' });
    } finally {
      client.release();
    }
    }, contextFromTraceparent(lifecycle.rows[0]?.traceparent));
  });

  app.register(async (webhookApp) => {
    webhookApp.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_request, body, done) => {
      done(null, body);
    });
    webhookApp.post('/api/webhooks/stripe', async (request, reply) => {
      const rawBody = request.body;
      const signature = request.headers['x-stripe-signature'];
      if (!Buffer.isBuffer(rawBody) || typeof signature !== 'string'
        || !verifyStripeSignature(rawBody, signature, stripeWebhookSecret)) {
        return reply.code(400).send({ error: 'Invalid webhook signature' });
      }
      let json: unknown;
      try {
        json = JSON.parse(rawBody.toString('utf8')) as unknown;
      } catch {
        return reply.code(400).send({ error: 'Invalid webhook payload' });
      }
      const parsed = stripeWebhookEventSchema.safeParse(json);
      if (!parsed.success) return reply.code(400).send({ error: 'Invalid webhook payload' });
      const event = parsed.data;
      const checkout = event.data.object;

      return withBusinessSpan('winner.purchase.mark-paid', {
        'messaging.message.id': event.eventId,
        'payment.session.id': checkout.id,
        'purchase.id': checkout.client_reference_id,
        'purchase.amount_cents': checkout.amount_total,
      }, async (span) => {

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const stored = await client.query<{
          id: string;
          amount_cents: number;
          currency: 'usd';
          status: 'pending' | 'paid';
          provider_session_id: string | null;
        }>(
          `SELECT id::text, amount_cents, currency, status, provider_session_id
           FROM purchases WHERE id = $1 FOR UPDATE`,
          [checkout.client_reference_id],
        );
        const purchase = stored.rows[0];
        if (!purchase || purchase.provider_session_id !== checkout.id
          || purchase.amount_cents !== checkout.amount_total || purchase.currency !== checkout.currency) {
          await client.query('ROLLBACK');
          span.setAttribute('winner.purchase.outcome', 'mismatch');
          return reply.code(400).send({ error: 'Webhook does not match the purchase' });
        }
        const inserted = await client.query(
          `INSERT INTO payment_webhook_events (id, purchase_id, provider_session_id, received_at)
           VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO NOTHING RETURNING id`,
          [event.eventId, purchase.id, checkout.id, clock.now()],
        );
        if (inserted.rowCount && purchase.status === 'pending') {
          await client.query(
            `UPDATE purchases SET status = 'paid', paid_at = $2 WHERE id = $1 AND status = 'pending'`,
            [purchase.id, event.occurredAt],
          );
        }
        await client.query('COMMIT');
        const duplicate = inserted.rowCount === 0 || purchase.status === 'paid';
        span.setAttribute('winner.purchase.outcome', duplicate ? 'duplicate' : 'paid');
        return { received: true, duplicate };
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
      }, contextFromHeaders(request.headers as Record<string, unknown>));
    });
  });

  app.post('/api/auctions', async (request, reply) => {
    const parsed = createAuctionSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'Invalid auction',
        fields: z.flattenError(parsed.error).fieldErrors,
      });
    }

    const auction = parsed.data;
    if (Date.parse(auction.endsAt) <= clock.now().getTime() + 60_000) {
      return reply.code(400).send({
        error: 'Invalid auction',
        fields: { endsAt: ['Closing time must be in the future'] },
      });
    }
    const baseSlug = slugify(auction.title);
    const existing = await pool.query('SELECT 1 FROM auctions WHERE slug = $1', [baseSlug]);
    const slug = existing.rowCount ? `${baseSlug}-${randomUUID().slice(0, 8)}` : baseSlug;
    const result = await pool.query<{ slug: string }>(
      `INSERT INTO auctions (
         slug, seller_user_id, title, kicker, category, art, starting_price_cents,
         ends_at, location, condition, description, specs
       )
       SELECT $1, u.id, $2, $3, $4, $5, $6, $7, $8, $9, $10, '[]'::jsonb
       FROM users u WHERE u.id = $11
       RETURNING slug`,
      [
        slug,
        auction.title,
        `Fresh listing from ${auction.location}`,
        auction.category,
        artByCategory[auction.category],
        auction.startingPriceCents,
        auction.endsAt,
        auction.location,
        auction.condition,
        auction.description,
        auction.userId,
      ],
    );
    if (!result.rows[0]) {
      return reply.code(400).send({ error: 'Unknown active user' });
    }
    return reply.code(201).send({ slug: result.rows[0].slug });
  });

  app.post('/api/auctions/:slug/bids', async (request, reply) => {
    const params = slugParamsSchema.safeParse(request.params);
    const body = createBidSchema.safeParse(request.body);
    if (!params.success || !body.success) {
      return reply.code(400).send({ error: 'Invalid bid' });
    }

    return withBusinessSpan('auction.bid', {
      'auction.slug': params.data.slug,
      'auction.bidder_user.id': body.data.userId,
      'auction.bid.amount_cents': body.data.amountCents,
    }, async (span) => {
      const recordOutcome = (outcome: string) => {
        span.updateName(outcome === 'accepted' ? 'auction.bid.accept' : 'auction.bid.reject');
        span.setAttribute('auction.bid.outcome', outcome);
      };

    const bidderResult = await pool.query<{ id: number; display_name: string; handle: string }>(
      'SELECT id, display_name, handle FROM users WHERE id = $1',
      [body.data.userId],
    );
    const bidder = bidderResult.rows[0];
    if (!bidder) {
      recordOutcome('unknown_user');
      return reply.code(400).send({ error: 'Unknown active user' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const auctionResult = await client.query<{
        id: string;
        seller_user_id: number;
        ends_at: Date;
        starting_price_cents: number;
        is_closed: boolean;
      }>(
        `SELECT a.id::text, a.seller_user_id, a.ends_at, a.starting_price_cents,
           (close.auction_id IS NOT NULL) AS is_closed
         FROM auctions a
         LEFT JOIN auction_closes close ON close.auction_id = a.id
         WHERE a.slug = $1
         FOR UPDATE OF a`,
        [params.data.slug],
      );
      const auction = auctionResult.rows[0];
      if (!auction) {
        await client.query('ROLLBACK');
        recordOutcome('auction_not_found');
        return reply.code(404).send({ error: 'Auction not found' });
      }

      const currentResult = await client.query<{ current_price_cents: number }>(
        `SELECT COALESCE(max(amount_cents), $2)::int AS current_price_cents
         FROM bids
         WHERE auction_id = $1`,
        [auction.id, auction.starting_price_cents],
      );
      const currentPriceCents = currentResult.rows[0].current_price_cents;
      const minimumBidCents = currentPriceCents + 100;
      const conflictDetails = {
        currentPriceCents,
        minimumBidCents,
        endsAt: auction.ends_at.toISOString(),
      };

      if (auction.seller_user_id === bidder.id) {
        await client.query('ROLLBACK');
        recordOutcome('seller_cannot_bid');
        return reply.code(409).send({
          code: 'SELLER_CANNOT_BID',
          error: 'Sellers cannot bid on their own auctions',
          ...conflictDetails,
        });
      }
      const acceptedAt = clock.now();
      if (auction.is_closed || auction.ends_at.getTime() <= acceptedAt.getTime()) {
        await client.query('ROLLBACK');
        recordOutcome('auction_closed');
        return reply.code(409).send({
          code: 'AUCTION_CLOSED',
          error: 'This auction has ended',
          ...conflictDetails,
        });
      }
      if (body.data.amountCents < minimumBidCents) {
        await client.query('ROLLBACK');
        recordOutcome('too_low');
        return reply.code(409).send({
          code: 'BID_TOO_LOW',
          error: 'Bid must be at least $1 above the current amount',
          ...conflictDetails,
        });
      }

      const inserted = await client.query<{ id: string; amount_cents: number; created_at: Date }>(
        `INSERT INTO bids (auction_id, bidder_user_id, amount_cents, created_at)
         VALUES ($1, $2, $3, $4)
         RETURNING id::text, amount_cents, created_at`,
        [auction.id, bidder.id, body.data.amountCents, acceptedAt],
      );
      await client.query(
        'UPDATE auctions SET traceparent = $2 WHERE id = $1',
        [auction.id, activeTraceparent()],
      );
      await client.query('COMMIT');
      const acceptedBid = toBid({
        ...inserted.rows[0],
        bidder_id: bidder.id,
        bidder_display_name: bidder.display_name,
        bidder_handle: bidder.handle,
      });
      recordOutcome('accepted');
      span.setAttributes({
        'auction.id': auction.id,
        'auction.bid.id': acceptedBid.id,
      });
      try {
        publishAuctionChanged({ slug: params.data.slug, bidId: acceptedBid.id });
        span.addEvent('auction.changed.emitted');
      } catch (error) {
        request.log.error({ err: error, slug: params.data.slug }, 'auction update publish failed');
      }
      return reply.code(201).send(acceptedBid);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    });
  });

  app.addHook('onClose', async () => pool.end());
  return app;
}
