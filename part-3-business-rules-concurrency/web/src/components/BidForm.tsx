import { type FormEvent, useEffect, useState } from 'react';
import {
  type AuctionItem,
  BidConflictError,
  createBid,
  type DemoUser,
  formatCurrency,
  formatTimeLeft,
  parseDollarsToCents,
} from '../catalog';

export async function refreshAuctionWithRetry(
  refresh: () => Promise<void>,
  attempts = 2,
): Promise<boolean> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await refresh();
      return true;
    } catch {
      // Refreshing is safe to retry; bid submission itself is never retried.
    }
  }
  return false;
}

export function BidForm({
  item,
  activeUser,
  onRefresh,
}: {
  item: AuctionItem;
  activeUser: DemoUser | null;
  onRefresh: () => Promise<void>;
}) {
  const [amount, setAmount] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const ended = formatTimeLeft(item.endsAt) === 'Ended';
  const isSeller = activeUser?.id === item.seller.id;
  const minimumBidCents = item.currentPriceCents + 100;

  useEffect(() => {
    setAmount('');
    setError('');
    setSuccess('');
  }, [activeUser?.id, item.slug]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeUser || ended || isSeller) return;
    const amountCents = parseDollarsToCents(amount);
    if (!amountCents || amountCents < minimumBidCents) {
      setSuccess('');
      setError(`Enter at least ${formatCurrency(minimumBidCents)}.`);
      return;
    }

    setError('');
    setSuccess('');
    setSubmitting(true);
    try {
      await createBid(item.slug, { userId: activeUser.id, amountCents });
      setAmount('');
      setSuccess('Bid accepted — you are the highest bidder.');
      await refreshAuctionWithRetry(onRefresh);
    } catch (caught) {
      if (caught instanceof BidConflictError) {
        const message = caught.code === 'BID_TOO_LOW'
          ? `Bid not placed — another bidder moved the minimum to ${formatCurrency(caught.minimumBidCents)}.`
          : caught.message;
        setError(message);
        await refreshAuctionWithRetry(onRefresh);
      } else {
        setError(caught instanceof Error ? caught.message : 'Could not place this bid.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  let unavailable = '';
  if (!activeUser) unavailable = 'Choosing an active bidder…';
  else if (ended) unavailable = 'Bidding has ended.';
  else if (isSeller) unavailable = 'You are selling this auction.';

  return <form className="bid-form" onSubmit={submit}><label htmlFor="bid">Your bid</label><div><span>$</span><input id="bid" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder={(minimumBidCents / 100).toFixed(2)} disabled={Boolean(unavailable) || submitting} aria-describedby="bid-guidance" /><button disabled={Boolean(unavailable) || submitting}>{submitting ? 'Placing…' : 'Place bid'}</button></div><small id="bid-guidance" className="bid-guidance">{unavailable || `Minimum bid ${formatCurrency(minimumBidCents)}`}</small>{error && <p className="bid-message error" role="alert">{error}</p>}{success && <p className="bid-message success" role="status">{success}</p>}</form>;
}
