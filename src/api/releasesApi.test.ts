import { describe, expect, it, vi } from 'vitest';
import type { Release } from '../domain/release';
import { InMemoryReleaseRepository, type ReleaseRepository } from '../data/releaseRepository';
import { getReleasesApiResponse } from './releasesApi';

describe('getReleasesApiResponse', () => {
  it('uses default query parameters', async () => {
    const repository: ReleaseRepository = {
      saveReleases: vi.fn(),
      findExistingReleaseIds: vi.fn().mockResolvedValue(new Set()),
      findCachedArtists: vi.fn().mockResolvedValue(new Map()),
      saveReleaseMarkets: vi.fn(),
      cleanupOldReleases: vi.fn(),
      listActiveGenres: vi.fn().mockResolvedValue([]),
      listActiveCountries: vi.fn().mockResolvedValue([]),
      findReleases: vi.fn().mockResolvedValue({
        items: [],
        pagination: {
          page: 1,
          limit: 20,
          total: 0,
          hasNextPage: false,
        },
      }),
    };
    const currentDate = new Date('2026-07-01T12:00:00.000Z');

    await getReleasesApiResponse(repository, {}, { currentDate });

    expect(repository.findReleases).toHaveBeenCalledWith({
      period: '7d',
      genre: undefined,
      genres: undefined,
      country: undefined,
      countries: undefined,
      type: 'all',
      sort: 'newest',
      page: 1,
      limit: 20,
      currentDate,
      randomStartSeed: undefined,
    });
  });

  it('filters and paginates through ReleaseRepository', async () => {
    const repository = new InMemoryReleaseRepository();

    await repository.saveReleases([
      makeRelease({ id: 'newer', releaseDate: '2026-06-30', genres: ['techno'], country: 'DE', type: 'single', popularity: 72 }),
      makeRelease({ id: 'older', releaseDate: '2026-06-29', genres: ['techno'], country: 'DE', type: 'single', popularity: 68 }),
      makeRelease({ id: 'wrong-country', releaseDate: '2026-06-30', genres: ['techno'], country: 'US', type: 'single', popularity: 90 }),
    ]);

    const response = await getReleasesApiResponse(
      repository,
      {
        period: '7d',
        genres: ['techno'],
        countries: ['DE'],
        type: 'single',
        sort: 'oldest',
        page: '2',
        limit: '1',
      },
      { currentDate: new Date('2026-07-01T12:00:00.000Z') },
    );

    expect(response).toEqual({
      items: [makeRelease({ id: 'newer', releaseDate: '2026-06-30', genres: ['techno'], country: 'DE', type: 'single', popularity: 72 })],
      genres: [{ name: 'techno', releaseCount: 3, kind: 'general' }],
      countries: [
        { name: 'DE', releaseCount: 2 },
        { name: 'US', releaseCount: 1 },
      ],
      pagination: {
        page: 2,
        limit: 1,
        total: 2,
        hasNextPage: false,
      },
      error: null,
    });
  });

  it.each([
    ['period', { period: '30d' }],
    ['type', { period: '7d', type: 'ep' }],
    ['sort', { period: '7d', sort: 'viral' }],
    ['page', { period: '7d', page: '0' }],
    ['limit', { period: '7d', limit: '0' }],
    ['limit max', { period: '7d', limit: '51' }],
  ])('returns invalid_query for invalid %s', async (_name, query) => {
    const repository: ReleaseRepository = {
      saveReleases: vi.fn(),
      findExistingReleaseIds: vi.fn().mockResolvedValue(new Set()),
      findCachedArtists: vi.fn().mockResolvedValue(new Map()),
      saveReleaseMarkets: vi.fn(),
      cleanupOldReleases: vi.fn(),
      listActiveGenres: vi.fn().mockResolvedValue([]),
      listActiveCountries: vi.fn().mockResolvedValue([]),
      findReleases: vi.fn(),
    };

    const response = await getReleasesApiResponse(repository, query);

    expect(response.error).toMatchObject({ code: 'invalid_query' });
    expect(response.items).toEqual([]);
    expect(response.pagination.total).toBe(0);
    expect(response.pagination.hasNextPage).toBe(false);
    expect(repository.findReleases).not.toHaveBeenCalled();
  });

  it('returns the success response format', async () => {
    const release = makeRelease({ id: 'success' });
    const repository: ReleaseRepository = {
      saveReleases: vi.fn(),
      findExistingReleaseIds: vi.fn().mockResolvedValue(new Set()),
      findCachedArtists: vi.fn().mockResolvedValue(new Map()),
      saveReleaseMarkets: vi.fn(),
      cleanupOldReleases: vi.fn(),
      listActiveGenres: vi.fn().mockResolvedValue([{ genre: 'pop', releaseCount: 1, kind: 'exact' }]),
      listActiveCountries: vi.fn().mockResolvedValue([{ country: 'Germany', releaseCount: 1 }]),
      findReleases: vi.fn().mockResolvedValue({
        items: [release],
        pagination: {
          page: 1,
          limit: 20,
          total: 1,
          hasNextPage: false,
        },
      }),
    };

    await expect(getReleasesApiResponse(repository, { period: '7d' })).resolves.toEqual({
      items: [release],
      genres: [{ name: 'pop', releaseCount: 1, kind: 'exact' }],
      countries: [{ name: 'Germany', releaseCount: 1 }],
      pagination: {
        page: 1,
        limit: 20,
        total: 1,
        hasNextPage: false,
      },
      error: null,
    });
  });

  it('returns the error response format', async () => {
    const repository: ReleaseRepository = {
      saveReleases: vi.fn(),
      findExistingReleaseIds: vi.fn().mockResolvedValue(new Set()),
      findCachedArtists: vi.fn().mockResolvedValue(new Map()),
      saveReleaseMarkets: vi.fn(),
      cleanupOldReleases: vi.fn(),
      listActiveGenres: vi.fn(),
      listActiveCountries: vi.fn(),
      findReleases: vi.fn(),
    };

    await expect(getReleasesApiResponse(repository, { period: 'bad', page: '3', limit: '10' })).resolves.toEqual({
      items: [],
      genres: [],
      countries: [],
      pagination: {
        page: 3,
        limit: 10,
        total: 0,
        hasNextPage: false,
      },
      error: {
        code: 'invalid_query',
        message: 'Invalid period query parameter.',
      },
    });
  });

  it('returns internal_error when the repository fails', async () => {
    const repository: ReleaseRepository = {
      saveReleases: vi.fn(),
      findExistingReleaseIds: vi.fn().mockResolvedValue(new Set()),
      findCachedArtists: vi.fn().mockResolvedValue(new Map()),
      saveReleaseMarkets: vi.fn(),
      cleanupOldReleases: vi.fn(),
      listActiveGenres: vi.fn().mockResolvedValue([]),
      listActiveCountries: vi.fn().mockResolvedValue([]),
      findReleases: vi.fn().mockRejectedValue(new Error('Database is unavailable.')),
    };

    await expect(getReleasesApiResponse(repository, { period: '7d', page: '2', limit: '10' })).resolves.toEqual({
      items: [],
      genres: [],
      countries: [],
      pagination: {
        page: 2,
        limit: 10,
        total: 0,
        hasNextPage: false,
      },
      error: {
        code: 'internal_error',
        message: 'Internal server error.',
      },
    });
  });
});

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
