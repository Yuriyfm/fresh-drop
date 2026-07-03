import { describe, expect, it, vi } from 'vitest';
import type { Release } from '../domain/release';
import type { ReleasePage, ReleaseRepository } from '../data/releaseRepository';
import { handleGetReleasesRoute } from './releasesRoute';

describe('handleGetReleasesRoute', () => {
  it('passes URL query parameters to the API handler through the repository query', async () => {
    const repository = makeRepository();
    const currentDate = new Date('2026-07-01T12:00:00.000Z');

    await handleGetReleasesRoute(
      repository,
      '/api/releases?period=14d&genre=techno&country=DE&type=single&sort=popular&page=2&limit=10&randomStartSeed=seed-1',
      { currentDate },
    );

    expect(repository.findReleases).toHaveBeenCalledWith({
      period: '14d',
      genre: 'techno',
      genres: ['techno'],
      country: 'DE',
      type: 'single',
      sort: 'popular',
      page: 2,
      limit: 10,
      currentDate,
      randomStartSeed: 'seed-1',
    });
  });

  it('handles missing query parameters with API defaults', async () => {
    const repository = makeRepository();

    await handleGetReleasesRoute(repository, '/api/releases');

    expect(repository.findReleases).toHaveBeenCalledWith({
      period: '7d',
      genre: undefined,
      genres: undefined,
      country: undefined,
      type: 'all',
      sort: 'newest',
      page: 1,
      limit: 20,
      currentDate: undefined,
      randomStartSeed: undefined,
    });
  });

  it('returns invalid_query for invalid route query parameters', async () => {
    const repository = makeRepository();

    const response = await handleGetReleasesRoute(repository, '?period=30d&page=3&limit=10');

    expect(response).toEqual({
      items: [],
      genres: [],
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
    expect(repository.findReleases).not.toHaveBeenCalled();
  });

  it('does not call Spotify or other network adapters for user search', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const repository = makeRepository();

    await handleGetReleasesRoute(repository, new URL('https://fresh-drop.local/api/releases?period=7d'));

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('preserves success response format from the API handler', async () => {
    const release = makeRelease();
    const repository = makeRepository({
      items: [release],
      pagination: {
        page: 1,
        limit: 20,
        total: 1,
        hasNextPage: false,
      },
    });

    await expect(handleGetReleasesRoute(repository, new URLSearchParams({ period: '7d' }))).resolves.toEqual({
      items: [release],
      genres: [{ name: 'techno', releaseCount: 1, kind: 'exact' }],
      pagination: {
        page: 1,
        limit: 20,
        total: 1,
        hasNextPage: false,
      },
      error: null,
    });
  });

  it('accepts query-like objects without changing the response shape', async () => {
    const repository = makeRepository();

    const response = await handleGetReleasesRoute(repository, { period: '7d', type: 'ep' });

    expect(response).toEqual({
      items: [],
      genres: [],
      pagination: {
        page: 1,
        limit: 20,
        total: 0,
        hasNextPage: false,
      },
      error: {
        code: 'invalid_query',
        message: 'Invalid type query parameter.',
      },
    });
  });
});

function makeRepository(
  findResult: ReleasePage = { items: [], pagination: { page: 1, limit: 20, total: 0, hasNextPage: false } },
): ReleaseRepository {
  return {
    saveReleases: vi.fn(),
    findExistingReleaseIds: vi.fn().mockResolvedValue(new Set()),
    cleanupOldReleases: vi.fn(),
    listActiveGenres: vi.fn().mockResolvedValue([{ genre: 'techno', releaseCount: 1, kind: 'exact' }]),
    findReleases: vi.fn().mockResolvedValue(findResult),
  };
}

function makeRelease(overrides: Partial<Release> = {}): Release {
  const artist = {
    id: 'artist-1',
    name: 'Artist One',
    genres: ['techno'],
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
    genres: ['techno'],
    country: 'DE',
    popularity: 70,
    ...overrides,
  };
}
