import { describe, expect, it } from 'vitest';
import { getReleaseCrawlerConfigFromEnv } from './crawlerConfig';

describe('getReleaseCrawlerConfigFromEnv', () => {
  it('uses adaptive crawler defaults with multi-market support', () => {
    const config = getReleaseCrawlerConfigFromEnv({}, new Date('2026-07-03T12:00:00.000Z'));

    expect(config.batchSize).toBe(5);
    expect(config.markets).toEqual(['US']);
    expect(config.searchLimit).toBe(10);
    expect(config.maxShardDepth).toBe(4);
    expect(config.maxSafeOffset).toBe(1000);
    expect(config.splitTotalThreshold).toBe(800);
    expect(config.artistCacheTtlDays).toBe(30);
    expect(config.searchSeeds).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ family: 'plain', token: '', priority: 100, depth: 0 }),
        expect.objectContaining({ family: 'plain', token: 'a' }),
        expect.objectContaining({ family: 'plain', token: '0' }),
        expect.objectContaining({ family: 'album', token: 'a' }),
        expect.objectContaining({ family: 'artist', token: 'a' }),
      ]),
    );
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

  it('reads multi-market crawling, shard limits, and artist cache ttl from env', () => {
    const config = getReleaseCrawlerConfigFromEnv({
      SPOTIFY_MARKETS: 'us, gb, de, us',
      SPOTIFY_CRAWLER_SEARCH_QUERIES: 'tag:new, tag:new album:a, tag:new artist:ab, tag:new z',
      SPOTIFY_CRAWLER_MAX_SHARD_DEPTH: '6',
      SPOTIFY_MAX_SAFE_OFFSET: '900',
      SPOTIFY_SPLIT_TOTAL_THRESHOLD: '700',
      SPOTIFY_ARTIST_CACHE_TTL_DAYS: '14',
      SPOTIFY_SEARCH_LIMIT: '15',
    }, new Date('2026-07-03T12:00:00.000Z'));

    expect(config.markets).toEqual(['US', 'GB', 'DE']);
    expect(config.searchSeeds).toEqual([
      { family: 'plain', token: '', priority: 100, depth: 0 },
      { family: 'album', token: 'a', priority: 90, depth: 1 },
      { family: 'artist', token: 'ab', priority: 78, depth: 2 },
      { family: 'plain', token: 'z', priority: 100, depth: 1 },
    ]);
    expect(config.maxShardDepth).toBe(6);
    expect(config.maxSafeOffset).toBe(900);
    expect(config.splitTotalThreshold).toBe(700);
    expect(config.artistCacheTtlDays).toBe(14);
    expect(config.searchLimit).toBe(15);
  });
});
