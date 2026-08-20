import { describe, expect, it } from 'vitest';
import {
  enqueueOutcomeNotification,
  handledOutcomeNotificationsKey,
  type OutcomeNotification,
  outcomeNotificationMessage,
  rememberOutcomeNotification,
} from './outcomeNotifications';

function notification(overrides: Partial<OutcomeNotification> = {}): OutcomeNotification {
  return {
    notificationId: '00000000-0000-4000-8000-000000000001',
    eventId: '00000000-0000-4000-8000-000000000011',
    recipientUserId: 1,
    recipientRole: 'seller',
    slug: 'test-gpu',
    title: 'Test GPU',
    endsAt: '2026-08-20T12:00:00.000Z',
    closedAt: '2026-08-20T12:00:01.000Z',
    winner: {
      bidId: '7',
      userId: 2,
      displayName: 'Maya Thompson',
      handle: 'maya',
      amountCents: 50_100,
    },
    ...overrides,
  };
}

describe('outcome notification queue', () => {
  it('uses role-specific winner, seller, and no-bid copy', () => {
    expect(outcomeNotificationMessage(notification({ recipientRole: 'winner' })))
      .toBe('You won Test GPU with a bid of $501.');
    expect(outcomeNotificationMessage(notification()))
      .toBe('Your auction for Test GPU ended. Maya Thompson won with $501.');
    expect(outcomeNotificationMessage(notification({ winner: null })))
      .toBe('Your auction for Test GPU ended without any bids.');
  });

  it('orders several outcomes by deadline and does not enqueue the same ID twice', () => {
    const later = notification({
      notificationId: '00000000-0000-4000-8000-000000000002',
      endsAt: '2026-08-20T12:01:00.000Z',
    });
    const earlier = notification();
    const queue = enqueueOutcomeNotification(enqueueOutcomeNotification([], later), earlier);
    expect(queue.map((item) => item.notificationId)).toEqual([
      earlier.notificationId,
      later.notificationId,
    ]);
    expect(enqueueOutcomeNotification(queue, earlier)).toBe(queue);
  });

  it('remembers a handled notification once per browser tab', () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };
    const id = '00000000-0000-4000-8000-000000000001';
    expect(rememberOutcomeNotification(id, storage)).toBe(true);
    expect(rememberOutcomeNotification(id, storage)).toBe(false);
    expect(JSON.parse(values.get(handledOutcomeNotificationsKey) ?? '[]')).toEqual([id]);
  });
});
