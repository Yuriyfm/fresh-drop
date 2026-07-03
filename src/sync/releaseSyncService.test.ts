import { describe, expect, it, vi } from 'vitest';
import type { Release } from '../domain/release';
import { InMemoryReleaseRepository } from '../data/releaseRepository';
import { SpotifyApiError } from '../spotify/spotifyApiAdapter';
import { createReleaseSyncService } from './releaseSyncService';

describe('createReleaseSyncService', () => {
  it('fetches fresh releases from Spotify ingestion adapter and saves them', async () => {
    const releases = [
      makeRelease({ id: 'spotify-1', title: 'First Fresh Release' }),
      makeRelease({ id: 'spotify-2', title: 'Second Fresh Release' }),
    ];
    const source = {
      fetchFreshReleasesFromSpotify: vi.fn().mockResolvedValue(releases),
    };
    const repository = new InMemoryReleaseRepository();
    const syncRuns = makeSyncRunRepository();
    const service = createReleaseSyncService(source, repository, syncRuns);

    await expect(service.syncFreshReleases({ limit: 25, market: 'US' })).resolves.toEqual({
      status: 'success',
      itemsFound: 2,
      itemsSaved: 2,
      itemsDeleted: 0,
      smoke: {
        releases: 2,
        artists: 1,
        releasesUnknownCountry: 2,
        artistsUnknownCountry: 1,
        releasesNullPopularity: 0,
        artistsNullPopularity: 0,
      },
      errorMessage: null,
    });
    expect(source.fetchFreshReleasesFromSpotify).toHaveBeenCalledWith({ limit: 25, market: 'US' });
    expect(syncRuns.startSyncRun).toHaveBeenCalledWith({ source: 'spotify' });
    expect(syncRuns.finishSyncRun).toHaveBeenCalledWith({
      id: 'sync-run-1',
      status: 'success',
      itemsFound: 2,
      itemsSaved: 2,
    });

    const saved = await repository.findReleases({
      period: '7d',
      type: 'all',
      sort: 'newest',
      currentDate: new Date('2026-07-01T12:00:00.000Z'),
    });
    expect(saved.items.map((release) => release.id).sort()).toEqual(['spotify-1', 'spotify-2']);
  });

  it('saves zero releases when Spotify returns an empty list', async () => {
    const source = {
      fetchFreshReleasesFromSpotify: vi.fn().mockResolvedValue([]),
    };
    const repository = new InMemoryReleaseRepository();
    const service = createReleaseSyncService(source, repository, makeSyncRunRepository());

    await expect(service.syncFreshReleases()).resolves.toEqual({
      status: 'success',
      itemsFound: 0,
      itemsSaved: 0,
      itemsDeleted: 0,
      smoke: {
        releases: 0,
        artists: 0,
        releasesUnknownCountry: 0,
        artistsUnknownCountry: 0,
        releasesNullPopularity: 0,
        artistsNullPopularity: 0,
      },
      errorMessage: null,
    });
  });

  it('reports smoke stats for unknown country and null popularity', async () => {
    const artistWithMissingData = {
      id: 'artist-2',
      name: 'Artist Two',
      genres: [],
      country: 'unknown',
      popularity: null,
    };
    const source = {
      fetchFreshReleasesFromSpotify: vi.fn().mockResolvedValue([
        makeRelease({
          id: 'release-1',
          artists: [artistWithMissingData],
          primaryArtist: artistWithMissingData,
          country: 'unknown',
          popularity: null,
        }),
        makeRelease({
          id: 'release-2',
          artists: [artistWithMissingData],
          primaryArtist: artistWithMissingData,
          country: 'unknown',
          popularity: null,
        }),
      ]),
    };
    const repository = new InMemoryReleaseRepository();
    const service = createReleaseSyncService(source, repository, makeSyncRunRepository());

    const result = await service.syncFreshReleases();

    expect(result.smoke).toEqual({
      releases: 2,
      artists: 1,
      releasesUnknownCountry: 2,
      artistsUnknownCountry: 1,
      releasesNullPopularity: 2,
      artistsNullPopularity: 1,
    });
  });

  it('cleans up stale releases after a successful sync', async () => {
    const source = {
      fetchFreshReleasesFromSpotify: vi.fn().mockResolvedValue([makeRelease({ id: 'fresh' })]),
    };
    const repository = {
      saveReleases: vi.fn().mockResolvedValue({ saved: 1 }),
      findExistingReleaseIds: vi.fn().mockResolvedValue(new Set()),
      findReleases: vi.fn(),
      listActiveGenres: vi.fn().mockResolvedValue([]),
      cleanupOldReleases: vi.fn().mockResolvedValue({ deleted: 3 }),
    };
    const service = createReleaseSyncService(source, repository, makeSyncRunRepository());

    await expect(service.syncFreshReleases()).resolves.toEqual({
      status: 'success',
      itemsFound: 1,
      itemsSaved: 1,
      itemsDeleted: 3,
      smoke: {
        releases: 1,
        artists: 1,
        releasesUnknownCountry: 1,
        artistsUnknownCountry: 1,
        releasesNullPopularity: 0,
        artistsNullPopularity: 0,
      },
      errorMessage: null,
    });
    expect(repository.cleanupOldReleases).toHaveBeenCalledWith(expect.any(Date), 30);
  });

  it('records saved count when cleanup fails after saving releases', async () => {
    const source = {
      fetchFreshReleasesFromSpotify: vi.fn().mockResolvedValue([makeRelease({ id: 'fresh' })]),
    };
    const repository = {
      saveReleases: vi.fn().mockResolvedValue({ saved: 1 }),
      findExistingReleaseIds: vi.fn().mockResolvedValue(new Set()),
      findReleases: vi.fn(),
      listActiveGenres: vi.fn().mockResolvedValue([]),
      cleanupOldReleases: vi.fn().mockRejectedValue(new Error('Cleanup failed.')),
    };
    const syncRuns = makeSyncRunRepository();
    const service = createReleaseSyncService(source, repository, syncRuns);

    await expect(service.syncFreshReleases()).resolves.toEqual({
      status: 'failed',
      itemsFound: 1,
      itemsSaved: 1,
      itemsDeleted: 0,
      smoke: {
        releases: 1,
        artists: 1,
        releasesUnknownCountry: 1,
        artistsUnknownCountry: 1,
        releasesNullPopularity: 0,
        artistsNullPopularity: 0,
      },
      errorMessage: 'Cleanup failed.',
    });
    expect(syncRuns.finishSyncRun).toHaveBeenCalledWith({
      id: 'sync-run-1',
      status: 'failed',
      itemsFound: 1,
      itemsSaved: 1,
      errorMessage: 'Cleanup failed.',
    });
  });

  it('records Spotify adapter errors without saving releases', async () => {
    const source = {
      fetchFreshReleasesFromSpotify: vi.fn().mockRejectedValue(new SpotifyApiError('Rate limited.', 'rate_limited', 429, 10)),
    };
    const repository = {
      saveReleases: vi.fn(),
      findExistingReleaseIds: vi.fn().mockResolvedValue(new Set()),
      findReleases: vi.fn(),
      listActiveGenres: vi.fn().mockResolvedValue([]),
      cleanupOldReleases: vi.fn(),
    };
    const syncRuns = makeSyncRunRepository();
    const service = createReleaseSyncService(source, repository, syncRuns);

    await expect(service.syncFreshReleases()).resolves.toEqual({
      status: 'failed',
      itemsFound: 0,
      itemsSaved: 0,
      itemsDeleted: 0,
      smoke: {
        releases: 0,
        artists: 0,
        releasesUnknownCountry: 0,
        artistsUnknownCountry: 0,
        releasesNullPopularity: 0,
        artistsNullPopularity: 0,
      },
      errorMessage: 'Rate limited. Retry after 10 seconds.',
    });
    expect(repository.saveReleases).not.toHaveBeenCalled();
    expect(repository.cleanupOldReleases).not.toHaveBeenCalled();
    expect(syncRuns.finishSyncRun).toHaveBeenCalledWith({
      id: 'sync-run-1',
      status: 'failed',
      itemsFound: 0,
      itemsSaved: 0,
      errorMessage: 'Rate limited. Retry after 10 seconds.',
    });
  });

  it('depends on fetchFreshReleasesFromSpotify instead of runtime search', async () => {
    const source = {
      fetchFreshReleasesFromSpotify: vi.fn().mockResolvedValue([makeRelease()]),
      searchFreshReleases: vi.fn().mockResolvedValue([]),
    };
    const repository = new InMemoryReleaseRepository();
    const service = createReleaseSyncService(source, repository, makeSyncRunRepository());

    await service.syncFreshReleases();

    expect(source.fetchFreshReleasesFromSpotify).toHaveBeenCalledTimes(1);
    expect(source.searchFreshReleases).not.toHaveBeenCalled();
  });
});

function makeSyncRunRepository() {
  return {
    startSyncRun: vi.fn().mockResolvedValue({
      id: 'sync-run-1',
      startedAt: new Date('2026-07-01T12:00:00.000Z'),
      finishedAt: null,
      status: 'running',
      source: 'spotify',
      itemsFound: 0,
      itemsSaved: 0,
      errorMessage: null,
    }),
    finishSyncRun: vi.fn().mockResolvedValue({
      id: 'sync-run-1',
      startedAt: new Date('2026-07-01T12:00:00.000Z'),
      finishedAt: new Date('2026-07-01T12:01:00.000Z'),
      status: 'success',
      source: 'spotify',
      itemsFound: 0,
      itemsSaved: 0,
      errorMessage: null,
    }),
    getLatestSyncRun: vi.fn().mockResolvedValue(null),
  };
}

function makeRelease(overrides: Partial<Release> = {}): Release {
  const artist = {
    id: 'artist-1',
    name: 'Artist One',
    genres: overrides.genres ?? ['pop'],
    country: 'unknown' as const,
    popularity: 70,
  };

  return {
    id: 'release-1',
    spotifyUrl: 'https://open.spotify.com/album/release-1',
    coverUrl: null,
    title: 'Release One',
    artists: [artist],
    primaryArtist: artist,
    type: 'single',
    releaseDate: '2026-06-30',
    releaseDatePrecision: 'day',
    genres: ['pop'],
    country: 'unknown',
    popularity: 70,
    ...overrides,
  };
}
