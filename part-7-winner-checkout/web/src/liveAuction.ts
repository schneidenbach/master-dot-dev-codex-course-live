import { io } from 'socket.io-client';

export type AuctionChangedEvent = {
  slug: string;
  bidId: string;
};

type SubscriptionResult = { ok: true } | { ok: false; error: string };

export function createRefreshCoalescer(refresh: () => Promise<void>): () => Promise<void> {
  let inFlight: Promise<void> | null = null;
  let trailingRefreshRequested = false;

  return () => {
    if (inFlight) {
      trailingRefreshRequested = true;
      return inFlight;
    }

    const run = async () => {
      let lastError: unknown;
      do {
        trailingRefreshRequested = false;
        try {
          await refresh();
          lastError = undefined;
        } catch (error) {
          lastError = error;
        }
      } while (trailingRefreshRequested);
      if (lastError) throw lastError;
    };

    inFlight = run().finally(() => {
      inFlight = null;
    });
    return inFlight;
  };
}

export function watchAuctionChanges(
  slug: string,
  onChanged: (event: AuctionChangedEvent) => void,
): () => void {
  const socket = io({ autoConnect: false, transports: ['websocket'] });
  socket.on('connect', () => {
    socket.emit('auction:watch', { slug }, (_result: SubscriptionResult) => undefined);
  });
  socket.on('auction:changed', (event: AuctionChangedEvent) => {
    if (event.slug === slug) onChanged(event);
  });
  const connectTimer = window.setTimeout(() => socket.connect(), 0);
  return () => {
    window.clearTimeout(connectTimer);
    socket.disconnect();
  };
}
