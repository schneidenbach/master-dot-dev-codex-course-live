import { describe, expect, it, vi } from 'vitest';
import {
  type AuctionCloseRefreshEnvironment,
  watchAuctionCloseOutcome,
} from './auctionClose';

function createEnvironment(now: number) {
  let scheduled: { callback: () => void; delayMs: number } | null = null;
  const environment: AuctionCloseRefreshEnvironment = {
    now: () => now,
    setTimeout: (callback, delayMs) => {
      scheduled = { callback, delayMs };
      return 1;
    },
    clearTimeout: vi.fn(() => { scheduled = null; }),
  };
  return {
    environment,
    scheduled: () => scheduled as { callback: () => void; delayMs: number } | null,
    run: async () => {
      if (!scheduled) throw new Error('No refresh scheduled');
      const { callback } = scheduled;
      scheduled = null;
      callback();
      await Promise.resolve();
      await Promise.resolve();
    },
  };
}

describe('authoritative auction close refresh', () => {
  it('refreshes at the deadline and polls until a close outcome rerenders the page', async () => {
    const deadline = Date.parse('2026-08-20T12:00:05.000Z');
    const fake = createEnvironment(deadline - 5_000);
    const refresh = vi.fn().mockResolvedValue(undefined);

    const stop = watchAuctionCloseOutcome(
      new Date(deadline).toISOString(),
      null,
      refresh,
      fake.environment,
    );
    expect(fake.scheduled()?.delayMs).toBe(5_000);

    await fake.run();
    expect(refresh).toHaveBeenCalledOnce();
    expect(fake.scheduled()?.delayMs).toBe(1_000);

    stop();
    expect(fake.scheduled()).toBeNull();
  });

  it('does not poll after the authoritative close is present', () => {
    const fake = createEnvironment(Date.parse('2026-08-20T12:00:05.000Z'));
    const refresh = vi.fn().mockResolvedValue(undefined);

    watchAuctionCloseOutcome(
      '2026-08-20T12:00:00.000Z',
      '2026-08-20T12:00:05.000Z',
      refresh,
      fake.environment,
    );

    expect(fake.scheduled()).toBeNull();
    expect(refresh).not.toHaveBeenCalled();
  });
});
