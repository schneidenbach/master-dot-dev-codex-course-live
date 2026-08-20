export type AuctionCloseRefreshEnvironment = {
  now(): number;
  setTimeout(callback: () => void, delayMs: number): number;
  clearTimeout(timer: number): void;
};

const browserEnvironment: AuctionCloseRefreshEnvironment = {
  now: () => Date.now(),
  setTimeout: (callback, delayMs) => window.setTimeout(callback, delayMs),
  clearTimeout: (timer) => window.clearTimeout(timer),
};

export function watchAuctionCloseOutcome(
  endsAt: string,
  closedAt: string | null,
  refresh: () => Promise<void>,
  environment: AuctionCloseRefreshEnvironment = browserEnvironment,
): () => void {
  if (closedAt) return () => undefined;

  let stopped = false;
  let timer: number | null = null;
  const deadline = Date.parse(endsAt);

  const schedule = (delayMs: number) => {
    timer = environment.setTimeout(() => {
      timer = null;
      void refresh().catch(() => undefined).finally(() => {
        if (!stopped) schedule(1_000);
      });
    }, delayMs);
  };

  schedule(Math.max(0, deadline - environment.now()));
  return () => {
    stopped = true;
    if (timer !== null) environment.clearTimeout(timer);
  };
}
