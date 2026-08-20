import { describe, expect, it, vi } from 'vitest';
import { type DeadlineEnvironment, watchAuctionDeadline } from './auctionDeadline';

function createEnvironment(initialNow: number) {
  let now = initialNow;
  let scheduled: { callback: () => void; delayMs: number } | null = null;
  let visibilityListener: (() => void) | null = null;
  let visible = true;
  const environment: DeadlineEnvironment = {
    now: () => now,
    setTimeout: (callback, delayMs) => {
      scheduled = { callback, delayMs };
      return 1;
    },
    clearTimeout: vi.fn(() => { scheduled = null; }),
    addVisibilityListener: (listener) => { visibilityListener = listener; },
    removeVisibilityListener: (listener) => {
      if (visibilityListener === listener) visibilityListener = null;
    },
    isVisible: () => visible,
  };
  return {
    environment,
    setNow: (value: number) => { now = value; },
    setVisible: (value: boolean) => { visible = value; },
    runTimer: () => {
      if (!scheduled) throw new Error('No deadline timer scheduled');
      const { callback } = scheduled;
      callback();
    },
    showTab: () => visibilityListener?.(),
    scheduled: () => scheduled as { callback: () => void; delayMs: number } | null,
    listener: () => visibilityListener,
  };
}

describe('auction deadline watcher', () => {
  it('notifies exactly at the deadline and stops scheduling', () => {
    const deadline = Date.parse('2026-08-20T12:00:10.000Z');
    const fake = createEnvironment(deadline - 10_000);
    const changes: number[] = [];

    const stop = watchAuctionDeadline(
      new Date(deadline).toISOString(),
      (now) => changes.push(now),
      fake.environment,
    );
    expect(changes).toEqual([deadline - 10_000]);
    expect(fake.scheduled()?.delayMs).toBe(10_000);

    fake.setNow(deadline);
    fake.runTimer();
    expect(changes).toEqual([deadline - 10_000, deadline]);
    expect(fake.scheduled()).toBeNull();

    stop();
    expect(fake.listener()).toBeNull();
  });

  it('recomputes an elapsed deadline when a backgrounded tab becomes visible', () => {
    const deadline = Date.parse('2026-08-20T12:00:10.000Z');
    const fake = createEnvironment(deadline - 5_000);
    const changes: number[] = [];

    watchAuctionDeadline(
      new Date(deadline).toISOString(),
      (now) => changes.push(now),
      fake.environment,
    );
    fake.setVisible(false);
    fake.setNow(deadline + 2_000);
    fake.setVisible(true);
    fake.showTab();

    expect(changes.at(-1)).toBe(deadline + 2_000);
    expect(fake.scheduled()).toBeNull();
  });
});
