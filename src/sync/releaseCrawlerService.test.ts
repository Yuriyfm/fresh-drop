import { describe, expect, it, vi } from 'vitest';
import type { Release } from '../domain/release';
import { InMemoryReleaseRepository } from '../data/releaseRepository';
import { InMemorySyncTaskRepository } from '../data/syncTaskRepository';
import { SpotifyApiError } from '../spotify/spotifyApiAdapter';
import { runReleaseCrawler } from './releaseCrawlerService';
import type { ReleaseCrawlerConfig } from './crawlerConfig';

describe('runReleaseCrawler', () => {
  it('seeds adaptive search shards for each market and saves unique recent releases', async () => {
    const source = {
      fetchReleaseSearchAlbumsPage: vi.fn().mockResolvedValue({
        albums: [makeAlbum()],
        total: 1,
        nextOffset: null,
        requestCount: 1,
      }),
      fetchArtistsByIds: vi.fn().mockResolvedValue({
        artistsById: new Map([
          ['artist-1', { id: 'artist-1', name: 'Artist One', genres: ['pop'], popularity: 50 }],
        ]),
        retryAfterSeconds: null,
        requestCount: 1,
      }),
      fetchArtistAlbumsPage: vi.fn(),
    };
    const releases = new InMemoryReleaseRepository();
    const tasks = new InMemorySyncTaskRepository();

    const result = await runReleaseCrawler(source, releases, tasks, makeConfig({
      markets: ['US', 'GB'],
      searchSeeds: [{ family: 'plain', token: '', priority: 100, depth: 0 }],
    }), new Date('2026-07-02T12:00:00.000Z'));

    expect(result).toMatchObject({
      tasksClaimed: 1,
      tasksSucceeded: 1,
      tasksFailed: 0,
      itemsFound: 1,
      itemsSaved: 1,
      tasksInserted: 2,
    });
    expect(result.taskSummaries).toEqual([
      expect.objectContaining({
        query: 'tag:new',
        market: 'US',
        family: 'plain',
        status: 'completed',
        itemsSeen: 1,
        uniqueAdded: 1,
        wasSplit: false,
        artistCacheHits: 0,
        artistRequestsSaved: 0,
      }),
    ]);

    const recurring = await tasks.claimPendingTasks(2, new Date('2026-07-03T00:00:00.000Z'));
    expect(recurring).toEqual(expect.arrayContaining([
      expect.objectContaining({
        source: 'search',
        query: 'tag:new',
        market: 'US',
        family: 'plain',
        token: '',
        attempts: 2,
      }),
      expect.objectContaining({
        source: 'search',
        query: 'tag:new',
        market: 'GB',
        family: 'plain',
        token: '',
        attempts: 1,
      }),
    ]));
  });

  it('skips artist enrichment for duplicate releases already present in the database', async () => {
    const source = {
      fetchReleaseSearchAlbumsPage: vi.fn().mockResolvedValue({
        albums: [makeAlbum({ id: 'existing-release' })],
        total: 1,
        nextOffset: null,
        requestCount: 1,
      }),
      fetchArtistsByIds: vi.fn(),
      fetchArtistAlbumsPage: vi.fn(),
    };
    const releases = new InMemoryReleaseRepository();
    const tasks = new InMemorySyncTaskRepository();

    await releases.saveReleases([makeRelease({ id: 'existing-release' })], {
      discoveredMarket: 'US',
      discoveredAt: new Date('2026-07-01T12:00:00.000Z'),
    });

    const result = await runReleaseCrawler(source, releases, tasks, makeConfig({
      markets: ['DE'],
      searchSeeds: [{ family: 'plain', token: '', priority: 100, depth: 0 }],
    }), new Date('2026-07-02T12:00:00.000Z'));

    expect(result).toMatchObject({
      itemsFound: 1,
      itemsSaved: 0,
    });
    expect(source.fetchArtistsByIds).not.toHaveBeenCalled();
    expect(result.taskSummaries).toEqual([
      expect.objectContaining({
        duplicatesSeen: 1,
        artistCacheHits: 0,
        artistRequestsSaved: 0,
      }),
    ]);
  });

  it('reuses cached artists for new releases and reports saved artist lookups', async () => {
    const source = {
      fetchReleaseSearchAlbumsPage: vi.fn().mockResolvedValue({
        albums: [makeAlbum({ id: 'new-release' })],
        total: 1,
        nextOffset: null,
        requestCount: 1,
      }),
      fetchArtistsByIds: vi.fn(),
      fetchArtistAlbumsPage: vi.fn(),
    };
    const releases = new InMemoryReleaseRepository();
    const tasks = new InMemorySyncTaskRepository();

    await releases.saveReleases([makeRelease({
      id: 'cached-release',
      artists: [{
        id: 'artist-1',
        name: 'Artist One',
        genres: ['ambient'],
        country: 'unknown',
        popularity: 55,
      }],
      primaryArtist: {
        id: 'artist-1',
        name: 'Artist One',
        genres: ['ambient'],
        country: 'unknown',
        popularity: 55,
      },
      genres: ['ambient'],
    })], {
      discoveredAt: new Date('2026-07-01T12:00:00.000Z'),
    });

    const result = await runReleaseCrawler(source, releases, tasks, makeConfig({
      markets: ['US'],
      searchSeeds: [{ family: 'plain', token: '', priority: 100, depth: 0 }],
    }), new Date('2026-07-02T12:00:00.000Z'));

    expect(source.fetchArtistsByIds).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      itemsFound: 1,
      itemsSaved: 1,
    });
    expect(result.taskSummaries).toEqual([
      expect.objectContaining({
        artistCacheHits: 1,
        artistRequestsSaved: 1,
      }),
    ]);
  });

  it('splits saturated search shards into child queries', async () => {
    const source = {
      fetchReleaseSearchAlbumsPage: vi
        .fn()
        .mockResolvedValueOnce({
          albums: Array.from({ length: 50 }, (_, index) => makeAlbum({ id: `release-${index}` })),
          total: 900,
          nextOffset: 50,
          requestCount: 1,
        })
        .mockResolvedValueOnce({
          albums: Array.from({ length: 50 }, (_, index) => makeAlbum({ id: `release-${50 + index}` })),
          total: 900,
          nextOffset: 100,
          requestCount: 1,
        })
        .mockResolvedValueOnce({
          albums: Array.from({ length: 50 }, (_, index) => makeAlbum({ id: `release-${100 + index}` })),
          total: 900,
          nextOffset: 150,
          requestCount: 1,
        })
        .mockResolvedValueOnce({
          albums: Array.from({ length: 50 }, (_, index) => makeAlbum({ id: `release-${150 + index}` })),
          total: 900,
          nextOffset: 200,
          requestCount: 1,
        })
        .mockResolvedValueOnce({
          albums: Array.from({ length: 50 }, (_, index) => makeAlbum({ id: `release-${200 + index}` })),
          total: 900,
          nextOffset: 250,
          requestCount: 1,
        })
        .mockResolvedValueOnce({
          albums: Array.from({ length: 50 }, (_, index) => makeAlbum({ id: `release-${250 + index}` })),
          total: 900,
          nextOffset: null,
          requestCount: 1,
        }),
      fetchArtistsByIds: vi.fn().mockResolvedValue({
        artistsById: new Map([
          ['artist-1', { id: 'artist-1', name: 'Artist One', genres: ['pop'], popularity: 50 }],
        ]),
        retryAfterSeconds: null,
        requestCount: 1,
      }),
      fetchArtistAlbumsPage: vi.fn(),
    };
    const releases = new InMemoryReleaseRepository();
    const tasks = new InMemorySyncTaskRepository();

    const result = await runReleaseCrawler(source, releases, tasks, makeConfig({
      markets: ['US'],
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
        spotifyTotal: 900,
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
      fetchReleaseSearchAlbumsPage: vi
        .fn()
        .mockResolvedValueOnce({
          albums: Array.from({ length: 50 }, (_, index) => makeAlbum({ id: `first-${index}` })),
          total: 400,
          nextOffset: 50,
          requestCount: 1,
        })
        .mockResolvedValueOnce({
          albums: Array.from({ length: 50 }, (_, index) => makeAlbum({ id: `first-${50 + index}` })),
          total: 400,
          nextOffset: 100,
          requestCount: 1,
        })
        .mockResolvedValueOnce({
          albums: Array.from({ length: 50 }, (_, index) => makeAlbum({ id: `first-${100 + index}` })),
          total: 400,
          nextOffset: 150,
          requestCount: 1,
        })
        .mockResolvedValueOnce({
          albums: Array.from({ length: 50 }, (_, index) => makeAlbum({ id: `first-${150 + index}` })),
          total: 400,
          nextOffset: 200,
          requestCount: 1,
        })
        .mockResolvedValueOnce({
          albums: Array.from({ length: 50 }, (_, index) => makeAlbum({ id: `first-${200 + index}` })),
          total: 400,
          nextOffset: 250,
          requestCount: 1,
        })
        .mockResolvedValueOnce({
          albums: Array.from({ length: 50 }, (_, index) => makeAlbum({ id: `first-${250 + index}` })),
          total: 400,
          nextOffset: null,
          requestCount: 1,
        }),
      fetchArtistsByIds: vi.fn().mockResolvedValue({
        artistsById: new Map([
          ['artist-1', { id: 'artist-1', name: 'Artist One', genres: ['pop'], popularity: 50 }],
        ]),
        retryAfterSeconds: null,
        requestCount: 1,
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
      fetchReleaseSearchAlbumsPage: vi
        .fn()
        .mockRejectedValueOnce(new SpotifyApiError('Rate limited.', 'rate_limited', 429, 120))
        .mockResolvedValueOnce({
          albums: [makeAlbum({ id: 'after-retry' })],
          total: 1,
          nextOffset: null,
          requestCount: 1,
        }),
      fetchArtistsByIds: vi.fn().mockResolvedValue({
        artistsById: new Map([
          ['artist-1', { id: 'artist-1', name: 'Artist One', genres: ['pop'], popularity: 50 }],
        ]),
        retryAfterSeconds: null,
        requestCount: 1,
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

  it('saves partial duplicate handling before stopping on artist rate limit', async () => {
    const source = {
      fetchReleaseSearchAlbumsPage: vi.fn().mockResolvedValueOnce({
        albums: [
          makeAlbum({ id: 'saved-1' }),
          makeAlbum({ id: 'saved-2', artists: [{ id: 'artist-2', name: 'Artist Two' }] }),
        ],
        total: 2,
        nextOffset: null,
        requestCount: 1,
      }),
      fetchArtistsByIds: vi.fn().mockResolvedValueOnce({
        artistsById: new Map(),
        retryAfterSeconds: 120,
        requestCount: 1,
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
      requestsMade: 2,
      itemsFound: 2,
      itemsSaved: 0,
      stoppedDueToRateLimit: true,
      retryAt: new Date('2026-07-03T12:02:00.000Z'),
    });
    expect(result.taskSummaries).toEqual([
      expect.objectContaining({
        query: 'tag:new',
        status: 'rate_limited',
        itemsFound: 2,
        itemsSaved: 0,
        requestCount: 2,
        retryAfterSeconds: 120,
      }),
    ]);
    await expect(releases.findExistingReleaseIds(['saved-1', 'saved-2'])).resolves.toEqual(new Set());
  });
});

function makeConfig(overrides: Partial<ReleaseCrawlerConfig> = {}): ReleaseCrawlerConfig {
  return {
    markets: ['TR'],
    batchSize: 1,
    searchLimit: 50,
    artistAlbumsLimit: 10,
    retentionDays: 30,
    searchSeeds: [{ family: 'plain', token: '', priority: 100, depth: 0 }],
    enableArtistExpansion: false,
    searchTaskCooldownMinutes: 720,
    maxShardDepth: 4,
    maxSafeOffset: 1000,
    splitTotalThreshold: 800,
    artistCacheTtlDays: 30,
    ...overrides,
  };
}

function makeAlbum(overrides: Partial<{ id: string; artists: Array<{ id: string; name: string }> }> = {}) {
  return {
    id: overrides.id ?? 'release-1',
    name: 'Release One',
    album_type: 'single',
    release_date: '2026-07-02',
    release_date_precision: 'day',
    external_urls: { spotify: 'https://open.spotify.com/album/release-1' },
    images: [{ url: 'https://image.example/cover.jpg' }],
    artists: overrides.artists ?? [{ id: 'artist-1', name: 'Artist One' }],
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
