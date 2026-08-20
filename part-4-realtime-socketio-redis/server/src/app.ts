import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import pg from 'pg';
import { z } from 'zod';
import type { AuctionChangedEvent } from './realtime.js';

const connectionString = process.env.DATABASE_URL ?? 'postgres://auction:auction@localhost:55432/auction_part_4';

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
    a.ends_at, a.location, a.condition, a.description, a.specs,
    seller.id AS seller_id, seller.display_name AS seller_display_name,
    seller.handle AS seller_handle
  FROM auctions a
  JOIN users seller ON seller.id = a.seller_user_id
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
}: {
  clock?: Clock;
  publishAuctionChanged?: (event: AuctionChangedEvent) => void;
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

    const bidderResult = await pool.query<{ id: number; display_name: string; handle: string }>(
      'SELECT id, display_name, handle FROM users WHERE id = $1',
      [body.data.userId],
    );
    const bidder = bidderResult.rows[0];
    if (!bidder) return reply.code(400).send({ error: 'Unknown active user' });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const auctionResult = await client.query<{
        id: string;
        seller_user_id: number;
        ends_at: Date;
        starting_price_cents: number;
      }>(
        `SELECT id::text, seller_user_id, ends_at, starting_price_cents
         FROM auctions
         WHERE slug = $1
         FOR UPDATE`,
        [params.data.slug],
      );
      const auction = auctionResult.rows[0];
      if (!auction) {
        await client.query('ROLLBACK');
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
        return reply.code(409).send({
          code: 'SELLER_CANNOT_BID',
          error: 'Sellers cannot bid on their own auctions',
          ...conflictDetails,
        });
      }
      const acceptedAt = clock.now();
      if (auction.ends_at.getTime() <= acceptedAt.getTime()) {
        await client.query('ROLLBACK');
        return reply.code(409).send({
          code: 'AUCTION_CLOSED',
          error: 'This auction has ended',
          ...conflictDetails,
        });
      }
      if (body.data.amountCents < minimumBidCents) {
        await client.query('ROLLBACK');
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
      await client.query('COMMIT');
      const acceptedBid = toBid({
        ...inserted.rows[0],
        bidder_id: bidder.id,
        bidder_display_name: bidder.display_name,
        bidder_handle: bidder.handle,
      });
      try {
        publishAuctionChanged({ slug: params.data.slug, bidId: acceptedBid.id });
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

  app.addHook('onClose', async () => pool.end());
  return app;
}
