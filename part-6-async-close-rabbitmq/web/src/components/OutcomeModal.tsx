import {
  type OutcomeNotification,
  outcomeNotificationMessage,
} from '../outcomeNotifications';

export function OutcomeModal({
  notification,
  queuedCount,
  onDismiss,
}: {
  notification: OutcomeNotification;
  queuedCount: number;
  onDismiss: () => void;
}) {
  return <div className="outcome-modal-screen"><section className="outcome-modal" role="dialog" aria-modal="true" aria-labelledby="outcome-modal-title"><div className="outcome-modal-icon" aria-hidden="true">✓</div><p className="eyebrow">Auction ended</p><h2 id="outcome-modal-title">{notification.recipientRole === 'winner' ? 'Congratulations' : 'Your auction has closed'}</h2><p>{outcomeNotificationMessage(notification)}</p>{queuedCount > 0 && <small>{queuedCount} more {queuedCount === 1 ? 'notification' : 'notifications'} waiting</small>}<div className="outcome-modal-actions"><button type="button" onClick={onDismiss}>Dismiss</button><a href={`/items/${encodeURIComponent(notification.slug)}`} onClick={onDismiss}>View auction</a></div></section></div>;
}
