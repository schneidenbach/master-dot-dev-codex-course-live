import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { z } from 'zod';
import { activeTraceparent, contextFromTraceparent, withBusinessSpan } from './tracing.js';

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

type DueAuctionRow = {
  id: string;
  slug: string;
  title: string;
  ends_at: Date;
  seller_id: number;
  seller_display_name: string;
  seller_handle: string;
  traceparent: string | null;
};

type WinningBidRow = {
  id: string;
  amount_cents: number;
  bidder_id: number;
  bidder_display_name: string;
  bidder_handle: string;
};

export async function closeDueAuctions({
  pool,
  now,
  batchSize = 50,
}: {
  pool: pg.Pool;
  now: Date;
  batchSize?: number;
}): Promise<ClosedAuction[]> {
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 500) {
    throw new RangeError('batchSize must be an integer between 1 and 500');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const due = await client.query<DueAuctionRow>(
      `SELECT a.id::text, a.slug, a.title, a.ends_at, a.traceparent,
         seller.id AS seller_id, seller.display_name AS seller_display_name,
         seller.handle AS seller_handle
       FROM auctions a
       JOIN users seller ON seller.id = a.seller_user_id
       WHERE a.ends_at <= $1
         AND NOT EXISTS (
           SELECT 1 FROM auction_closes close WHERE close.auction_id = a.id
         )
       ORDER BY a.ends_at, a.id
       FOR UPDATE OF a SKIP LOCKED
       LIMIT $2`,
      [now, batchSize],
    );

    const closed: ClosedAuction[] = [];
    for (const auction of due.rows) {
      await withBusinessSpan('auction.close', {
        'auction.id': auction.id,
        'auction.slug': auction.slug,
      }, async (span) => {
        const winnerResult = await client.query<WinningBidRow>(
          `SELECT b.id::text, b.amount_cents,
             bidder.id AS bidder_id, bidder.display_name AS bidder_display_name,
             bidder.handle AS bidder_handle
           FROM bids b
           JOIN users bidder ON bidder.id = b.bidder_user_id
           WHERE b.auction_id = $1
           ORDER BY b.amount_cents DESC, b.created_at ASC, b.id ASC
           LIMIT 1`,
          [auction.id],
        );
        const winner = winnerResult.rows[0] ?? null;
        const eventId = randomUUID();
        const event: AuctionClosedEvent = {
          eventId,
          eventType: 'AuctionClosed',
          auctionId: auction.id,
          slug: auction.slug,
          title: auction.title,
          endsAt: auction.ends_at.toISOString(),
          closedAt: now.toISOString(),
          seller: {
            id: auction.seller_id,
            displayName: auction.seller_display_name,
            handle: auction.seller_handle,
          },
          winner: winner ? {
            bidId: winner.id,
            userId: winner.bidder_id,
            displayName: winner.bidder_display_name,
            handle: winner.bidder_handle,
            amountCents: winner.amount_cents,
          } : null,
        };
        const traceparent = activeTraceparent();

        await client.query(
          `INSERT INTO auction_closes (auction_id, closed_at, winning_bid_id, traceparent)
           VALUES ($1, $2, $3, $4)`,
          [auction.id, now, winner?.id ?? null, traceparent],
        );
        await client.query(
          `INSERT INTO outbox_events (
             id, event_type, auction_id, payload, occurred_at, traceparent
           ) VALUES ($1, 'AuctionClosed', $2, $3::jsonb, $4, $5)`,
          [eventId, auction.id, JSON.stringify(event), now, traceparent],
        );
        span.setAttributes({
          'auction.close.outcome': winner ? 'winner_selected' : 'no_bids',
          'auction.winning_bid.id': winner?.id ?? 'none',
          'auction.winning_bid.amount_cents': winner?.amount_cents ?? 0,
          'messaging.message.id': eventId,
        });
        closed.push({
          auctionId: auction.id,
          slug: auction.slug,
          winningBidId: winner?.id ?? null,
          outboxEventId: eventId,
        });
      }, contextFromTraceparent(auction.traceparent));
    }

    await client.query('COMMIT');
    return closed;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
