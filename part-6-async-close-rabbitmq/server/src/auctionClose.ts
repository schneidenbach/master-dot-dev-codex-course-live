import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, isNull, lte } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { z } from 'zod';
import type { Database } from './db/index.js';
import { auctionCloses, auctions, bids, outboxEvents, users } from './db/schema.js';

export const auctionClosedEventSchema = z.object({
  eventId: z.string().uuid(),
  eventType: z.literal('AuctionClosed'),
  auctionId: z.string().regex(/^\d+$/),
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  title: z.string().min(1),
  endsAt: z.string().datetime({ offset: true }),
  closedAt: z.string().datetime({ offset: true }),
  seller: z.object({
    id: z.number().int().positive(),
    displayName: z.string().min(1),
    handle: z.string().regex(/^[a-z0-9_]+$/),
  }),
  winner: z.object({
    bidId: z.string().regex(/^\d+$/),
    userId: z.number().int().positive(),
    displayName: z.string().min(1),
    handle: z.string().regex(/^[a-z0-9_]+$/),
    amountCents: z.number().int().positive(),
  }).nullable(),
});

export type AuctionClosedEvent = z.infer<typeof auctionClosedEventSchema>;

export type ClosedAuction = {
  auctionId: string;
  slug: string;
  winningBidId: string | null;
  outboxEventId: string;
};

export async function closeDueAuctions({
  db,
  now,
  batchSize = 50,
}: {
  db: Database;
  now: Date;
  batchSize?: number;
}): Promise<ClosedAuction[]> {
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 500) {
    throw new RangeError('batchSize must be an integer between 1 and 500');
  }

  return db.transaction(async (tx) => {
    const seller = alias(users, 'seller');
    const due = await tx.select({
      id: auctions.id,
      slug: auctions.slug,
      title: auctions.title,
      endsAt: auctions.endsAt,
      sellerId: seller.id,
      sellerDisplayName: seller.displayName,
      sellerHandle: seller.handle,
    })
      .from(auctions)
      .innerJoin(seller, eq(seller.id, auctions.sellerUserId))
      .leftJoin(auctionCloses, eq(auctionCloses.auctionId, auctions.id))
      .where(and(lte(auctions.endsAt, now), isNull(auctionCloses.auctionId)))
      .orderBy(asc(auctions.endsAt), asc(auctions.id))
      .limit(batchSize)
      .for('update', { of: auctions, skipLocked: true });

    const closed: ClosedAuction[] = [];
    for (const auction of due) {
      const bidder = alias(users, 'bidder');
      const [winner] = await tx.select({
        id: bids.id,
        amountCents: bids.amountCents,
        bidderId: bidder.id,
        bidderDisplayName: bidder.displayName,
        bidderHandle: bidder.handle,
      })
        .from(bids)
        .innerJoin(bidder, eq(bidder.id, bids.bidderUserId))
        .where(eq(bids.auctionId, auction.id))
        .orderBy(desc(bids.amountCents), asc(bids.createdAt), asc(bids.id))
        .limit(1);
      const eventId = randomUUID();
      const event: AuctionClosedEvent = {
        eventId,
        eventType: 'AuctionClosed',
        auctionId: auction.id.toString(),
        slug: auction.slug,
        title: auction.title,
        endsAt: auction.endsAt.toISOString(),
        closedAt: now.toISOString(),
        seller: {
          id: auction.sellerId,
          displayName: auction.sellerDisplayName,
          handle: auction.sellerHandle,
        },
        winner: winner ? {
          bidId: winner.id.toString(),
          userId: winner.bidderId,
          displayName: winner.bidderDisplayName,
          handle: winner.bidderHandle,
          amountCents: winner.amountCents,
        } : null,
      };

      await tx.insert(auctionCloses).values({
        auctionId: auction.id,
        closedAt: now,
        winningBidId: winner?.id ?? null,
      });
      await tx.insert(outboxEvents).values({
        id: eventId,
        eventType: 'AuctionClosed',
        auctionId: auction.id,
        payload: event,
        occurredAt: now,
      });
      closed.push({
        auctionId: auction.id.toString(),
        slug: auction.slug,
        winningBidId: winner?.id.toString() ?? null,
        outboxEventId: eventId,
      });
    }
    return closed;
  });
}
