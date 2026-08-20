import { describe, expect, it, vi } from 'vitest';
import { refreshAuctionWithRetry } from './BidForm';

describe('stale bid refresh recovery', () => {
  it('retries a failed auction refresh without retrying beyond the bound', async () => {
    const refresh = vi.fn()
      .mockRejectedValueOnce(new Error('temporary read failure'))
      .mockResolvedValueOnce(undefined);

    await expect(refreshAuctionWithRetry(refresh)).resolves.toBe(true);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('fails gracefully after both refresh attempts fail', async () => {
    const refresh = vi.fn().mockRejectedValue(new Error('read unavailable'));

    await expect(refreshAuctionWithRetry(refresh)).resolves.toBe(false);
    expect(refresh).toHaveBeenCalledTimes(2);
  });
});
