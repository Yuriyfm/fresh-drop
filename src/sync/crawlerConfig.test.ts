import { describe, expect, it } from 'vitest';
import { getReleaseCrawlerConfigFromEnv } from './crawlerConfig';

describe('getReleaseCrawlerConfigFromEnv', () => {
  it('uses cautious defaults for batch processing', () => {
    const config = getReleaseCrawlerConfigFromEnv({}, new Date('2026-07-03T12:00:00.000Z'));

    expect(config.batchSize).toBe(5);
    expect(config.maxShardDepth).toBe(4);
    expect(config.maxSafeOffset).toBe(950);
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

  it('reads explicit shard seeds and shard limits from env', () => {
    const config = getReleaseCrawlerConfigFromEnv({
      SPOTIFY_CRAWLER_SEARCH_QUERIES: 'tag:new, tag:new album:a, tag:new artist:ab, tag:new z',
      SPOTIFY_CRAWLER_MAX_SHARD_DEPTH: '6',
      SPOTIFY_CRAWLER_MAX_SAFE_OFFSET: '900',
    }, new Date('2026-07-03T12:00:00.000Z'));

    expect(config.searchSeeds).toEqual([
      { family: 'plain', token: '', priority: 100, depth: 0 },
      { family: 'album', token: 'a', priority: 90, depth: 1 },
      { family: 'artist', token: 'ab', priority: 78, depth: 2 },
      { family: 'plain', token: 'z', priority: 100, depth: 1 },
    ]);
    expect(config.maxShardDepth).toBe(6);
    expect(config.maxSafeOffset).toBe(900);
  });
});
