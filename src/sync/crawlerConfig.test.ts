import { describe, expect, it } from 'vitest';
import { getReleaseCrawlerConfigFromEnv } from './crawlerConfig';

describe('getReleaseCrawlerConfigFromEnv', () => {
  it('uses cautious defaults for batch processing', () => {
    expect(
      getReleaseCrawlerConfigFromEnv({}, new Date('2026-07-03T12:00:00.000Z')).batchSize,
    ).toBe(5);
  });

  it('reads and clamps crawler batch size from env', () => {
    expect(
      getReleaseCrawlerConfigFromEnv({
        SPOTIFY_CRAWLER_BATCH_SIZE: '8',
      }, new Date('2026-07-03T12:00:00.000Z')).batchSize,
    ).toBe(8);

    expect(
      getReleaseCrawlerConfigFromEnv({
        SPOTIFY_CRAWLER_BATCH_SIZE: '500',
      }, new Date('2026-07-03T12:00:00.000Z')).batchSize,
    ).toBe(100);
  });
});
