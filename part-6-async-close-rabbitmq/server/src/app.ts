import { randomUUID } from 'node:crypto';
import {
  asc,
  count,
  desc,
  eq,
  ilike,
  isNull,
  max,
  or,
  type SQL,
} from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import Fastify from 'fastify';
import { z } from 'zod';
import { createDatabase, type Database } from './db/index.js';
import { auctionCloses, auctions, bids, users } from './db/schema.js';
import type { AuctionChangedEvent } from './realtime.js';

const connectionString = process.env.DATABASE_URL
  ?? 'postgres://auction:auction@localhost:55432/auction_part_6';

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

const seller = alias(users, 'seller');
const winningBid = alias(bids, 'winning_bid');
const winner = alias(users, 'winner');

function auctionRows(db: Database, where?: SQL) {
  const topBidder = alias(users, 'top_bidder');
  const topBid = db.selectDistinctOn([bids.auctionId], {
    auctionId: bids.auctionId,
    amountCents: bids.amountCents,
    bidderHandle: topBidder.handle,
  })
    .from(bids)
    .innerJoin(topBidder, eq(topBidder.id, bids.bidderUserId))
    .orderBy(bids.auctionId, desc(bids.amountCents), asc(bids.createdAt), asc(bids.id))
    .as('top_bid');
  const bidTotals = db.select({
    auctionId: bids.auctionId,
    bidCount: count(bids.id).as('bid_count'),
  })
    .from(bids)
    .groupBy(bids.auctionId)
    .as('bid_totals');

  return db.select({
    slug: auctions.slug,
    title: auctions.title,
    kicker: auctions.kicker,
    category: auctions.category,
    art: auctions.art,
    startingPriceCents: auctions.startingPriceCents,
    topBidAmountCents: topBid.amountCents,
    bidCount: bidTotals.bidCount,
    currentBidder: topBid.bidderHandle,
    endsAt: auctions.endsAt,
    closedAt: auctionCloses.closedAt,
    winningBidId: winningBid.id,
    winningBidAmountCents: winningBid.amountCents,
    winningBidCreatedAt: winningBid.createdAt,
    winningBidderId: winner.id,
    winningBidderDisplayName: winner.displayName,
    winningBidderHandle: winner.handle,
    sellerId: seller.id,
    sellerDisplayName: seller.displayName,
    sellerHandle: seller.handle,
    location: auctions.location,
    condition: auctions.condition,
    description: auctions.description,
    specs: auctions.specs,
  })
    .from(auctions)
    .innerJoin(seller, eq(seller.id, auctions.sellerUserId))
    .leftJoin(auctionCloses, eq(auctionCloses.auctionId, auctions.id))
    .leftJoin(winningBid, eq(winningBid.id, auctionCloses.winningBidId))
    .leftJoin(winner, eq(winner.id, winningBid.bidderUserId))
    .leftJoin(topBid, eq(topBid.auctionId, auctions.id))
    .leftJoin(bidTotals, eq(bidTotals.auctionId, auctions.id))
    .where(where)
    .orderBy(asc(auctions.endsAt), asc(auctions.id));
}

type AuctionRow = Awaited<ReturnType<typeof auctionRows>>[number];

function toAuction(row: AuctionRow) {
  const hasWinningBid = row.winningBidId !== null
    && row.winningBidAmountCents !== null
    && row.winningBidCreatedAt !== null
    && row.winningBidderId !== null
    && row.winningBidderDisplayName !== null
    && row.winningBidderHandle !== null;
  return {
    slug: row.slug,
    title: row.title,
    kicker: row.kicker,
    category: row.category,
    art: row.art,
    currentPriceCents: row.topBidAmountCents ?? row.startingPriceCents,
    bidCount: row.bidCount ?? 0,
    currentBidder: row.currentBidder,
    endsAt: row.endsAt.toISOString(),
    closedAt: row.closedAt?.toISOString() ?? null,
    winningBid: hasWinningBid ? {
      id: row.winningBidId!.toString(),
      amountCents: row.winningBidAmountCents!,
      createdAt: row.winningBidCreatedAt!.toISOString(),
      bidder: {
        id: row.winningBidderId!,
        displayName: row.winningBidderDisplayName!,
        handle: row.winningBidderHandle!,
      },
    } : null,
    seller: {
      id: row.sellerId,
      displayName: row.sellerDisplayName,
      handle: row.sellerHandle,
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
  const { db, pool } = createDatabase(connectionString);

  app.addHook('onRequest', async (request, reply) => {
    reply.header('x-request-id', request.id);
  });

  app.get('/api/health', async (request, reply) => {
    try {
      await db.select({ id: users.id }).from(users).limit(1);
      return { ok: true, db: 'ok', requestId: request.id };
    } catch (error) {
      request.log.error({ err: error }, 'database health check failed');
      return reply.code(503).send({ ok: false, db: 'down', requestId: request.id });
    }
  });

  app.get('/api/users', async () => {
    const rows = await db.select({
      id: users.id,
      displayName: users.displayName,
      handle: users.handle,
    }).from(users).orderBy(asc(users.id));
    return rows;
  });

  app.get('/api/auctions', async (request, reply) => {
    const parsed = listQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid auction search query' });
    }

    const query = parsed.data.q ?? '';
    const where = query === '' ? undefined : or(
      ilike(auctions.title, `%${query}%`),
      ilike(auctions.kicker, `%${query}%`),
      ilike(auctions.category, `%${query}%`),
    );
    const rows = await auctionRows(db, where);
    return rows.map(toAuction);
  });

  app.get('/api/auctions/:slug', async (request, reply) => {
    const parsed = slugParamsSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid auction slug' });
    }

    const rows = await auctionRows(db, eq(auctions.slug, parsed.data.slug));
    const auction = rows[0];
    if (!auction) {
      return reply.code(404).send({ error: 'Auction not found' });
    }
    const bidder = alias(users, 'bidder');
    const bidHistory = await db.select({
      id: bids.id,
      amountCents: bids.amountCents,
      createdAt: bids.createdAt,
      bidderId: bidder.id,
      bidderDisplayName: bidder.displayName,
      bidderHandle: bidder.handle,
    })
      .from(bids)
      .innerJoin(bidder, eq(bidder.id, bids.bidderUserId))
      .innerJoin(auctions, eq(auctions.id, bids.auctionId))
      .where(eq(auctions.slug, parsed.data.slug))
      .orderBy(desc(bids.createdAt), desc(bids.id));
    return {
      ...toAuction(auction),
      bidHistory: bidHistory.map((bid) => ({
        id: bid.id.toString(),
        amountCents: bid.amountCents,
        createdAt: bid.createdAt.toISOString(),
        bidder: {
          id: bid.bidderId,
          displayName: bid.bidderDisplayName,
          handle: bid.bidderHandle,
        },
      })),
    };
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
    const [activeUser] = await db.select({ id: users.id })
      .from(users)
      .where(eq(users.id, auction.userId))
      .limit(1);
    if (!activeUser) {
      return reply.code(400).send({ error: 'Unknown active user' });
    }
    const baseSlug = slugify(auction.title);
    const [existing] = await db.select({ id: auctions.id })
      .from(auctions)
      .where(eq(auctions.slug, baseSlug))
      .limit(1);
    const slug = existing ? `${baseSlug}-${randomUUID().slice(0, 8)}` : baseSlug;
    const [created] = await db.insert(auctions).values({
      slug,
      sellerUserId: activeUser.id,
      title: auction.title,
      kicker: `Fresh listing from ${auction.location}`,
      category: auction.category,
      art: artByCategory[auction.category],
      startingPriceCents: auction.startingPriceCents,
      endsAt: new Date(auction.endsAt),
      location: auction.location,
      condition: auction.condition,
      description: auction.description,
      specs: [],
    }).returning({ slug: auctions.slug });
    return reply.code(201).send({ slug: created.slug });
  });

  app.post('/api/auctions/:slug/bids', async (request, reply) => {
    const params = slugParamsSchema.safeParse(request.params);
    const body = createBidSchema.safeParse(request.body);
    if (!params.success || !body.success) {
      return reply.code(400).send({ error: 'Invalid bid' });
    }

    const [bidder] = await db.select({
      id: users.id,
      displayName: users.displayName,
      handle: users.handle,
    }).from(users).where(eq(users.id, body.data.userId)).limit(1);
    if (!bidder) return reply.code(400).send({ error: 'Unknown active user' });

    const result = await db.transaction(async (tx) => {
      const [auction] = await tx.select({
        id: auctions.id,
        sellerUserId: auctions.sellerUserId,
        endsAt: auctions.endsAt,
        startingPriceCents: auctions.startingPriceCents,
        closeAuctionId: auctionCloses.auctionId,
      })
        .from(auctions)
        .leftJoin(auctionCloses, eq(auctionCloses.auctionId, auctions.id))
        .where(eq(auctions.slug, params.data.slug))
        .for('update', { of: auctions });
      if (!auction) return { status: 'not-found' } as const;

      const [current] = await tx.select({ amountCents: max(bids.amountCents) })
        .from(bids)
        .where(eq(bids.auctionId, auction.id));
      const currentPriceCents = current.amountCents ?? auction.startingPriceCents;
      const minimumBidCents = currentPriceCents + 100;
      const conflictDetails = {
        currentPriceCents,
        minimumBidCents,
        endsAt: auction.endsAt.toISOString(),
      };

      if (auction.sellerUserId === bidder.id) {
        return { status: 'seller', ...conflictDetails } as const;
      }
      const acceptedAt = clock.now();
      if (auction.closeAuctionId !== null || auction.endsAt.getTime() <= acceptedAt.getTime()) {
        return { status: 'closed', ...conflictDetails } as const;
      }
      if (body.data.amountCents < minimumBidCents) {
        return { status: 'too-low', ...conflictDetails } as const;
      }

      const [inserted] = await tx.insert(bids).values({
        auctionId: auction.id,
        bidderUserId: bidder.id,
        amountCents: body.data.amountCents,
        createdAt: acceptedAt,
      }).returning({
        id: bids.id,
        amountCents: bids.amountCents,
        createdAt: bids.createdAt,
      });
      return { status: 'accepted', inserted } as const;
    });

    if (result.status === 'not-found') {
      return reply.code(404).send({ error: 'Auction not found' });
    }
    if (result.status !== 'accepted') {
      const conflict = result.status === 'seller' ? {
        code: 'SELLER_CANNOT_BID', error: 'Sellers cannot bid on their own auctions',
      } : result.status === 'closed' ? {
        code: 'AUCTION_CLOSED', error: 'This auction has ended',
      } : {
        code: 'BID_TOO_LOW', error: 'Bid must be at least $1 above the current amount',
      };
      const { status: _status, ...conflictDetails } = result;
      return reply.code(409).send({ ...conflict, ...conflictDetails });
    }

    const acceptedBid = {
      id: result.inserted.id.toString(),
      amountCents: result.inserted.amountCents,
      createdAt: result.inserted.createdAt.toISOString(),
      bidder,
    };
    try {
      publishAuctionChanged({ slug: params.data.slug, bidId: acceptedBid.id });
    } catch (error) {
      request.log.error({ err: error, slug: params.data.slug }, 'auction update publish failed');
    }
    return reply.code(201).send(acceptedBid);
  });

  app.addHook('onClose', async () => pool.end());
  return app;
}
