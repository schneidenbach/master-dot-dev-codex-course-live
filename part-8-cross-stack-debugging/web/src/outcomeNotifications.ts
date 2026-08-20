import { io } from 'socket.io-client';

export type OutcomeNotification = {
  notificationId: string;
  eventId: string;
  recipientUserId: number;
  recipientRole: 'seller' | 'winner';
  slug: string;
  title: string;
  endsAt: string;
  closedAt: string;
  winner: null | {
    bidId: string;
    userId: number;
    displayName: string;
    handle: string;
    amountCents: number;
  };
};

type SubscriptionResult = { ok: true } | { ok: false; error: string };
type NotificationStorage = Pick<Storage, 'getItem' | 'setItem'>;

export const handledOutcomeNotificationsKey = 'auction-house-handled-outcome-notifications';

export function rememberOutcomeNotification(
  notificationId: string,
  storage: NotificationStorage = sessionStorage,
): boolean {
  let handled: string[] = [];
  try {
    const stored = JSON.parse(storage.getItem(handledOutcomeNotificationsKey) ?? '[]') as unknown;
    if (Array.isArray(stored)) handled = stored.filter((value): value is string => typeof value === 'string');
  } catch {
    // Replace malformed tab-local state with the next valid notification ID.
  }
  if (handled.includes(notificationId)) return false;
  const next = [...handled.slice(-199), notificationId];
  storage.setItem(handledOutcomeNotificationsKey, JSON.stringify(next));
  return true;
}

export function enqueueOutcomeNotification(
  queue: OutcomeNotification[],
  notification: OutcomeNotification,
): OutcomeNotification[] {
  if (queue.some((queued) => queued.notificationId === notification.notificationId)) return queue;
  return [...queue, notification].sort((left, right) => (
    Date.parse(left.endsAt) - Date.parse(right.endsAt)
    || left.notificationId.localeCompare(right.notificationId)
  ));
}

export function outcomeNotificationMessage(notification: OutcomeNotification): string {
  if (notification.recipientRole === 'winner' && notification.winner) {
    return `You won ${notification.title} with a bid of ${formatCurrency(notification.winner.amountCents)}.`;
  }
  if (notification.winner) {
    return `Your auction for ${notification.title} ended. ${notification.winner.displayName} won with ${formatCurrency(notification.winner.amountCents)}.`;
  }
  return `Your auction for ${notification.title} ended without any bids.`;
}

function formatCurrency(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

export function watchOutcomeNotifications(
  userId: number,
  onNotification: (notification: OutcomeNotification) => void,
): () => void {
  const socket = io({ autoConnect: false, transports: ['websocket'] });
  socket.on('connect', () => {
    socket.emit('user:identify', { userId }, (_result: SubscriptionResult) => undefined);
  });
  socket.on('auction:closed', onNotification);
  const connectTimer = window.setTimeout(() => socket.connect(), 0);
  return () => {
    window.clearTimeout(connectTimer);
    socket.disconnect();
  };
}
