import { useState } from 'react';
import {
  type OutcomeNotification,
  outcomeNotificationMessage,
} from '../outcomeNotifications';

export function OutcomeModal({
  notification,
  queuedCount,
  onDismiss,
  onCheckout,
}: {
  notification: OutcomeNotification;
  queuedCount: number;
  onDismiss: () => void;
  onCheckout?: () => Promise<void>;
}) {
  const [checkoutPending, setCheckoutPending] = useState(false);
  const [checkoutError, setCheckoutError] = useState('');
  async function checkout() {
    if (!onCheckout || checkoutPending) return;
    setCheckoutPending(true);
    setCheckoutError('');
    try {
      await onCheckout();
    } catch (error) {
      setCheckoutError(error instanceof Error ? error.message : 'Checkout is temporarily unavailable.');
      setCheckoutPending(false);
    }
  }
  return <div className="outcome-modal-screen"><section className="outcome-modal" role="dialog" aria-modal="true" aria-labelledby="outcome-modal-title"><div className="outcome-modal-icon" aria-hidden="true">✓</div><p className="eyebrow">Auction ended</p><h2 id="outcome-modal-title">{notification.recipientRole === 'winner' ? 'Congratulations' : 'Your auction has closed'}</h2><p>{outcomeNotificationMessage(notification)}</p>{queuedCount > 0 && <small>{queuedCount} more {queuedCount === 1 ? 'notification' : 'notifications'} waiting</small>}{checkoutError && <p className="checkout-error" role="alert">{checkoutError}</p>}<div className="outcome-modal-actions"><button type="button" onClick={onDismiss}>Dismiss</button><a href={`/items/${encodeURIComponent(notification.slug)}`} onClick={onDismiss}>View auction</a>{onCheckout && <button className="checkout-primary" type="button" disabled={checkoutPending} onClick={() => void checkout()}>{checkoutPending ? 'Opening checkout…' : 'Complete purchase'}</button>}</div></section></div>;
}
