const maximumTimeoutMs = 2_147_483_647;

export type DeadlineEnvironment = {
  now(): number;
  setTimeout(callback: () => void, delayMs: number): number;
  clearTimeout(timerId: number): void;
  addVisibilityListener(listener: () => void): void;
  removeVisibilityListener(listener: () => void): void;
  isVisible(): boolean;
};

const browserEnvironment: DeadlineEnvironment = {
  now: () => Date.now(),
  setTimeout: (callback, delayMs) => window.setTimeout(callback, delayMs),
  clearTimeout: (timerId) => window.clearTimeout(timerId),
  addVisibilityListener: (listener) => document.addEventListener('visibilitychange', listener),
  removeVisibilityListener: (listener) => document.removeEventListener('visibilitychange', listener),
  isVisible: () => document.visibilityState === 'visible',
};

export function watchAuctionDeadline(
  endsAt: string,
  onTimeChange: (now: number) => void,
  environment: DeadlineEnvironment = browserEnvironment,
): () => void {
  const deadline = Date.parse(endsAt);
  let timerId: number | null = null;

  const sync = () => {
    if (timerId !== null) environment.clearTimeout(timerId);
    timerId = null;
    const now = environment.now();
    onTimeChange(now);
    const remaining = deadline - now;
    if (remaining > 0) {
      timerId = environment.setTimeout(sync, Math.min(remaining, maximumTimeoutMs));
    }
  };
  const handleVisibilityChange = () => {
    if (environment.isVisible()) sync();
  };

  sync();
  environment.addVisibilityListener(handleVisibilityChange);
  return () => {
    if (timerId !== null) environment.clearTimeout(timerId);
    environment.removeVisibilityListener(handleVisibilityChange);
  };
}
