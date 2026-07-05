import { describe, expect, it } from 'vitest';
import { MusicBrainzRateLimiter } from './musicbrainzRateLimiter';

describe('MusicBrainzRateLimiter', () => {
  it('does not execute requests in parallel', async () => {
    let now = 0;
    const startTimes: number[] = [];
    const limiter = new MusicBrainzRateLimiter({
      minIntervalMs: 1100,
      nowFn: () => now,
      sleepFn: async (delayMs) => {
        now += delayMs;
      },
    });

    await Promise.all([
      limiter.schedule(async () => {
        startTimes.push(now);
      }),
      limiter.schedule(async () => {
        startTimes.push(now);
      }),
      limiter.schedule(async () => {
        startTimes.push(now);
      }),
    ]);

    expect(startTimes).toEqual([0, 1100, 2200]);
  });
});
