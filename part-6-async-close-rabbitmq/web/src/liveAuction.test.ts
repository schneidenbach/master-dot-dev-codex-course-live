import { describe, expect, it, vi } from 'vitest';
import { createRefreshCoalescer } from './liveAuction';

describe('live auction refresh coalescing', () => {
  it('turns overlapping requests into one in-flight and one trailing refresh', async () => {
    let releaseFirst: (() => void) | undefined;
    const refresh = vi.fn()
      .mockImplementationOnce(() => new Promise<void>((resolve) => {
        releaseFirst = resolve;
      }))
      .mockResolvedValue(undefined);
    const coalescedRefresh = createRefreshCoalescer(refresh);

    const first = coalescedRefresh();
    const second = coalescedRefresh();
    const third = coalescedRefresh();
    expect(refresh).toHaveBeenCalledTimes(1);
    releaseFirst?.();
    await Promise.all([first, second, third]);

    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('allows a later event to retry after a failed background refresh', async () => {
    const refresh = vi.fn()
      .mockRejectedValueOnce(new Error('temporary read failure'))
      .mockResolvedValue(undefined);
    const coalescedRefresh = createRefreshCoalescer(refresh);

    await expect(coalescedRefresh()).rejects.toThrow('temporary read failure');
    await expect(coalescedRefresh()).resolves.toBeUndefined();
    expect(refresh).toHaveBeenCalledTimes(2);
  });
});
