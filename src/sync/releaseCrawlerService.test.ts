import { describe, expect, it, vi } from 'vitest';
import type { Release } from '../domain/release';
import { InMemoryReleaseRepository } from '../data/releaseRepository';
import { InMemorySyncTaskRepository } from '../data/syncTaskRepository';
import { SpotifyApiError } from '../spotify/spotifyApiAdapter';
import { runReleaseCrawler } from './releaseCrawlerService';
import type { ReleaseCrawlerConfig } from './crawlerConfig';

describe('runReleaseCrawler', () => {
  it('seeds adaptive search shards and saves unique recent releases', async () => {
    const source = {
      fetchReleaseSearchPage: vi.fn().mockResolvedValue({
        releases: [makeRelease()],
        total: 1,
        nextOffset: null,
      }),
      fetchArtistAlbumsPage: vi.fn(),
    };
    const releases = new InMemoryReleaseRepository();
    const tasks = new InMemorySyncTaskRepository();

    const result = await runReleaseCrawler(source, releases, tasks, makeConfig({
      searchSeeds: [{ family: 'plain', token: '', priority: 100, depth: 0 }],
    }), new Date('2026-07-02T12:00:00.000Z'));

    expect(result).toMatchObject({
      tasksClaimed: 1,
      tasksSucceeded: 1,
      tasksFailed: 0,
      itemsFound: 1,
      itemsSaved: 1,
    });
    expect(result.taskSummaries).toEqual([
      expect.objectContaining({
        query: 'tag:new',
        family: 'plain',
        status: 'completed',
        itemsSeen: 1,
        uniqueAdded: 1,
        wasSplit: false,
      }),
    ]);

    const [recurring] = await tasks.claimPendingTasks(1, new Date('2026-07-03T00:00:00.000Z'));
    expect(recurring).toEqual(expect.objectContaining({
      source: 'search',
      query: 'tag:new',
      family: 'plain',
      token: '',
      attempts: 2,
    }));
  });

  it('splits saturated search shards into child queries', async () => {
    const source = {
      fetchReleaseSearchPage: vi
        .fn()
        .mockResolvedValueOnce({
          releases: Array.from({ length: 50 }, (_, index) => makeRelease({ id: `release-${index}` })),
          total: 1200,
          nextOffset: 50,
        })
        .mockResolvedValueOnce({
          releases: Array.from({ length: 50 }, (_, index) => makeRelease({ id: `release-${50 + index}` })),
          total: 1200,
          nextOffset: 100,
        })
        .mockResolvedValueOnce({
          releases: Array.from({ length: 50 }, (_, index) => makeRelease({ id: `release-${100 + index}` })),
          total: 1200,
          nextOffset: 150,
        })
        .mockResolvedValueOnce({
          releases: Array.from({ length: 50 }, (_, index) => makeRelease({ id: `release-${150 + index}` })),
          total: 1200,
          nextOffset: 200,
        })
        .mockResolvedValueOnce({
          releases: Array.from({ length: 50 }, (_, index) => makeRelease({ id: `release-${200 + index}` })),
          total: 1200,
          nextOffset: 250,
        })
        .mockResolvedValueOnce({
          releases: Array.from({ length: 50 }, (_, index) => makeRelease({ id: `release-${250 + index}` })),
          total: 1200,
          nextOffset: null,
        }),
      fetchArtistAlbumsPage: vi.fn(),
    };
    const releases = new InMemoryReleaseRepository();
    const tasks = new InMemorySyncTaskRepository();

    const result = await runReleaseCrawler(source, releases, tasks, makeConfig({
      searchSeeds: [{ family: 'album', token: 'a', priority: 90, depth: 1 }],
    }), new Date('2026-07-02T12:00:00.000Z'));

    expect(result).toMatchObject({
      tasksClaimed: 1,
      tasksSucceeded: 1,
      tasksInserted: 27,
      itemsFound: 300,
      itemsSaved: 300,
    });
    expect(result.taskSummaries).toEqual([
      expect.objectContaining({
        query: 'tag:new album:a',
        status: 'completed',
        wasSplit: true,
        childTasksInserted: 26,
        spotifyTotal: 1200,
      }),
    ]);

    const children = await tasks.claimPendingTasks(30, new Date('2026-07-03T00:00:00.000Z'));
    expect(children).toEqual(expect.arrayContaining([
      expect.objectContaining({ query: 'tag:new album:aa', family: 'album', token: 'aa', depth: 2 }),
      expect.objectContaining({ query: 'tag:new album:az', family: 'album', token: 'az', depth: 2 }),
    ]));
  });

  it('marks low-yield shards as exhausted and reruns them later with lower priority', async () => {
    const source = {
      fetchReleaseSearchPage: vi
        .fn()
        .mockResolvedValueOnce({
          releases: Array.from({ length: 50 }, (_, index) => makeRelease({ id: `first-${index}` })),
          total: 400,
          nextOffset: 50,
        })
        .mockResolvedValueOnce({
          releases: Array.from({ length: 50 }, (_, index) => makeRelease({ id: `first-${50 + index}` })),
          total: 400,
          nextOffset: 100,
        })
        .mockResolvedValueOnce({
          releases: Array.from({ length: 50 }, (_, index) => makeRelease({ id: `first-${100 + index}` })),
          total: 400,
          nextOffset: 150,
        })
        .mockResolvedValueOnce({
          releases: Array.from({ length: 50 }, (_, index) => makeRelease({ id: `first-${150 + index}` })),
          total: 400,
          nextOffset: 200,
        })
        .mockResolvedValueOnce({
          releases: Array.from({ length: 50 }, (_, index) => makeRelease({ id: `first-${200 + index}` })),
          total: 400,
          nextOffset: 250,
        })
        .mockResolvedValueOnce({
          releases: Array.from({ length: 50 }, (_, index) => makeRelease({ id: `first-${250 + index}` })),
          total: 400,
          nextOffset: null,
        }),
      fetchArtistAlbumsPage: vi.fn(),
    };
    const releases = new InMemoryReleaseRepository();
    const tasks = new InMemorySyncTaskRepository();
    await releases.saveReleases(Array.from({ length: 299 }, (_, index) => makeRelease({ id: `first-${index}` })));

    await runReleaseCrawler(source, releases, tasks, makeConfig({
      searchSeeds: [{ family: 'plain', token: 'z', priority: 100, depth: 1 }],
    }), new Date('2026-07-02T12:00:00.000Z'));

    const [rerun] = await tasks.claimPendingTasks(1, new Date('2026-07-04T12:00:00.000Z'));
    expect(rerun).toEqual(expect.objectContaining({
      query: 'tag:new z',
      attempts: 2,
    }));
    expect(rerun.priority).toBeLessThan(100);
  });

  it('requeues rate-limited search shards after retry-after and stops the batch', async () => {
    const source = {
      fetchReleaseSearchPage: vi
        .fn()
        .mockRejectedValueOnce(new SpotifyApiError('Rate limited.', 'rate_limited', 429, 120))
        .mockResolvedValueOnce({
          releases: [makeRelease({ id: 'after-retry' })],
          total: 1,
          nextOffset: null,
        }),
      fetchArtistAlbumsPage: vi.fn(),
    };
    const releases = new InMemoryReleaseRepository();
    const tasks = new InMemorySyncTaskRepository();
    const currentDate = new Date('2026-07-03T12:00:00.000Z');

    const result = await runReleaseCrawler(source, releases, tasks, makeConfig({
      searchSeeds: [
        { family: 'plain', token: '', priority: 100, depth: 0 },
        { family: 'plain', token: 'a', priority: 100, depth: 1 },
      ],
      batchSize: 2,
    }), currentDate);

    expect(result).toMatchObject({
      tasksClaimed: 2,
      tasksSucceeded: 0,
      tasksFailed: 1,
      tasksDeferred: 1,
      stoppedDueToRateLimit: true,
      retryAt: new Date('2026-07-03T12:02:00.000Z'),
    });
    expect(result.taskSummaries).toEqual([
      expect.objectContaining({
        query: 'tag:new',
        status: 'rate_limited',
        retryAfterSeconds: 120,
        retryAt: new Date('2026-07-03T12:02:00.000Z'),
      }),
    ]);

    await expect(tasks.claimPendingTasks(10, new Date('2026-07-03T12:01:59.000Z'))).resolves.toEqual([]);
    await expect(tasks.claimPendingTasks(10, new Date('2026-07-03T12:02:00.000Z'))).resolves.toEqual([
      expect.objectContaining({ query: 'tag:new', attempts: 2 }),
      expect.objectContaining({ query: 'tag:new a', attempts: 2 }),
    ]);
  });

  it('saves partial search results before stopping on rate limit', async () => {
    const source = {
      fetchReleaseSearchPage: vi
        .fn()
        .mockResolvedValueOnce({
          releases: [
            makeRelease({ id: 'saved-1' }),
            makeRelease({ id: 'saved-2' }),
          ],
          total: 2,
          nextOffset: null,
          retryAfterSeconds: 120,
        }),
      fetchArtistAlbumsPage: vi.fn(),
    };
    const releases = new InMemoryReleaseRepository();
    const tasks = new InMemorySyncTaskRepository();

    const result = await runReleaseCrawler(source, releases, tasks, makeConfig({
      searchSeeds: [{ family: 'plain', token: '', priority: 100, depth: 0 }],
    }), new Date('2026-07-03T12:00:00.000Z'));

    expect(result).toMatchObject({
      tasksClaimed: 1,
      tasksSucceeded: 0,
      tasksFailed: 1,
      requestsMade: 0,
      itemsFound: 2,
      itemsSaved: 2,
      stoppedDueToRateLimit: true,
      retryAt: new Date('2026-07-03T12:02:00.000Z'),
    });
    expect(result.taskSummaries).toEqual([
      expect.objectContaining({
        query: 'tag:new',
        status: 'rate_limited',
        itemsFound: 2,
        itemsSaved: 2,
        requestCount: 0,
        retryAfterSeconds: 120,
      }),
    ]);
    await expect(releases.findExistingReleaseIds(['saved-1', 'saved-2'])).resolves.toEqual(new Set(['saved-1', 'saved-2']));
  });
});

function makeConfig(overrides: Partial<ReleaseCrawlerConfig> = {}): ReleaseCrawlerConfig {
  return {
    market: 'TR',
    batchSize: 1,
    searchLimit: 50,
    artistAlbumsLimit: 10,
    retentionDays: 30,
    searchSeeds: [{ family: 'plain', token: '', priority: 100, depth: 0 }],
    enableArtistExpansion: false,
    searchTaskCooldownMinutes: 720,
    maxShardDepth: 4,
    maxSafeOffset: 950,
    ...overrides,
  };
}

function makeRelease(overrides: Partial<Release> = {}): Release {
  const artist = {
    id: 'artist-1',
    name: 'Artist One',
    genres: ['pop'],
    country: 'unknown' as const,
    popularity: 50,
  };

  return {
    id: 'release-1',
    spotifyUrl: 'https://open.spotify.com/album/release-1',
    coverUrl: null,
    title: 'Release One',
    artists: [artist],
    primaryArtist: artist,
    type: 'single',
    releaseDate: '2026-07-02',
    releaseDatePrecision: 'day',
    genres: ['pop'],
    country: 'unknown',
    popularity: 50,
    ...overrides,
  };
}
