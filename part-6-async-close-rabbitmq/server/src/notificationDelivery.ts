import { randomUUID } from 'node:crypto';
import { and, asc, eq, isNull } from 'drizzle-orm';
import type { AuctionClosedEvent } from './auctionClose.js';
import type { Database } from './db/index.js';
import { notificationDeliveries } from './db/schema.js';

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

export async function deliverAuctionOutcome({
  db,
  event,
  now,
  emit,
}: {
  db: Database;
  event: AuctionClosedEvent;
  now: Date;
  emit: (userId: number, notification: OutcomeNotification) => void | Promise<void>;
}): Promise<string[]> {
  const recipients: Array<{ userId: number; role: 'seller' | 'winner' }> = [
    { userId: event.seller.id, role: 'seller' },
  ];
  if (event.winner) recipients.push({ userId: event.winner.userId, role: 'winner' });

  await db.transaction(async (tx) => {
    for (const recipient of recipients) {
      await tx.insert(notificationDeliveries).values({
        id: randomUUID(),
        outboxEventId: event.eventId,
        recipientUserId: recipient.userId,
        recipientRole: recipient.role,
        createdAt: now,
      }).onConflictDoNothing({
        target: [notificationDeliveries.outboxEventId, notificationDeliveries.recipientUserId],
      });
    }
  });

  const pending = await db.select({
    id: notificationDeliveries.id,
    recipientUserId: notificationDeliveries.recipientUserId,
    recipientRole: notificationDeliveries.recipientRole,
  })
    .from(notificationDeliveries)
    .where(and(
      eq(notificationDeliveries.outboxEventId, event.eventId),
      isNull(notificationDeliveries.emittedAt),
    ))
    .orderBy(asc(notificationDeliveries.createdAt), asc(notificationDeliveries.id));
  const emitted: string[] = [];
  for (const delivery of pending) {
    await emit(delivery.recipientUserId, {
      notificationId: delivery.id,
      eventId: event.eventId,
      recipientUserId: delivery.recipientUserId,
      recipientRole: delivery.recipientRole,
      slug: event.slug,
      title: event.title,
      endsAt: event.endsAt,
      closedAt: event.closedAt,
      winner: event.winner,
    });
    await db.update(notificationDeliveries)
      .set({ emittedAt: now })
      .where(and(
        eq(notificationDeliveries.id, delivery.id),
        isNull(notificationDeliveries.emittedAt),
      ));
    emitted.push(delivery.id);
  }
  return emitted;
}
