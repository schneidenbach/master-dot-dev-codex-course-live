import { randomUUID } from 'node:crypto';
import pg from 'pg';
import type { AuctionClosedEvent } from './auctionClose.js';

export type OutcomeNotification = {
  notificationId: string;
  eventId: string;
  recipientUserId: number;
  recipientRole: 'seller' | 'winner';
  slug: string;
  title: string;
  endsAt: string;
  closedAt: string;
  winner: AuctionClosedEvent['winner'];
};

type PendingDeliveryRow = {
  id: string;
  recipient_user_id: number;
  recipient_role: 'seller' | 'winner';
};

export async function deliverAuctionOutcome({
  pool,
  event,
  now,
  emit,
}: {
  pool: pg.Pool;
  event: AuctionClosedEvent;
  now: Date;
  emit: (userId: number, notification: OutcomeNotification) => void | Promise<void>;
}): Promise<string[]> {
  const recipients: Array<{ userId: number; role: 'seller' | 'winner' }> = [
    { userId: event.seller.id, role: 'seller' },
  ];
  if (event.winner) recipients.push({ userId: event.winner.userId, role: 'winner' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const recipient of recipients) {
      await client.query(
        `INSERT INTO notification_deliveries (
           id, outbox_event_id, recipient_user_id, recipient_role, created_at
         ) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (outbox_event_id, recipient_user_id) DO NOTHING`,
        [randomUUID(), event.eventId, recipient.userId, recipient.role, now],
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  const pending = await pool.query<PendingDeliveryRow>(
    `SELECT id::text, recipient_user_id, recipient_role
     FROM notification_deliveries
     WHERE outbox_event_id = $1 AND emitted_at IS NULL
     ORDER BY created_at, id`,
    [event.eventId],
  );
  const emitted: string[] = [];
  for (const delivery of pending.rows) {
    await emit(delivery.recipient_user_id, {
      notificationId: delivery.id,
      eventId: event.eventId,
      recipientUserId: delivery.recipient_user_id,
      recipientRole: delivery.recipient_role,
      slug: event.slug,
      title: event.title,
      endsAt: event.endsAt,
      closedAt: event.closedAt,
      winner: event.winner,
    });
    await pool.query(
      `UPDATE notification_deliveries
       SET emitted_at = $1
       WHERE id = $2 AND emitted_at IS NULL`,
      [now, delivery.id],
    );
    emitted.push(delivery.id);
  }
  return emitted;
}
