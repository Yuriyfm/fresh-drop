import { describe, expect, it } from 'vitest';
import type { Release } from '../domain/release';
import { InMemoryReleaseRepository } from './releaseRepository';

describe('InMemoryReleaseRepository', () => {
  it('upserts releases by spotify id', async () => {
    const repository = new InMemoryReleaseRepository();

    await repository.saveReleases([makeRelease({ id: 'spotify-1', title: 'Old title' })]);
    await repository.saveReleases([makeRelease({ id: 'spotify-1', title: 'New title' })]);

    const result = await repository.findReleases({
      period: '7d',
      type: 'all',
      sort: 'newest',
      currentDate: new Date('2026-07-01T12:00:00.000Z'),
    });

    expect(result.pagination.total).toBe(1);
    expect(result.items[0].title).toBe('New title');
  });

  it('finds existing release ids', async () => {
    const repository = new InMemoryReleaseRepository();

    await repository.saveReleases([makeRelease({ id: 'spotify-1' })]);

    await expect(repository.findExistingReleaseIds(['spotify-1', 'missing', 'spotify-1'])).resolves.toEqual(new Set(['spotify-1']));
  });

  it('returns cached artists when they are still fresh', async () => {
    const repository = new InMemoryReleaseRepository();

    await repository.saveReleases([
      makeRelease({
        id: 'spotify-1',
        artists: [
          {
            id: 'artist-1',
            name: 'Artist One',
            genres: ['ambient'],
            country: 'unknown',
            popularity: 70,
          },
        ],
      }),
    ], {
      discoveredAt: new Date('2026-07-01T12:00:00.000Z'),
    });

    await expect(repository.findCachedArtists(['artist-1', 'missing'], {
      maxAgeDays: 30,
      now: new Date('2026-07-10T12:00:00.000Z'),
    })).resolves.toEqual(new Map([
      ['artist-1', {
        id: 'artist-1',
        name: 'Artist One',
        genres: ['ambient'],
        country: 'unknown',
        popularity: 70,
      }],
    ]));
  });

  it('reads releases with filters and pagination', async () => {
    const repository = new InMemoryReleaseRepository();

    await repository.saveReleases([
      makeRelease({ id: 'match-1', releaseDate: '2026-06-30', genres: ['death metal'], country: 'SE', type: 'album', popularity: 78 }),
      makeRelease({ id: 'match-2', releaseDate: '2026-06-29', genres: ['death metal'], country: 'SE', type: 'album', popularity: 62 }),
      makeRelease({ id: 'wrong-genre', releaseDate: '2026-06-30', genres: ['pop'], country: 'SE', type: 'album', popularity: 80 }),
    ]);

    const result = await repository.findReleases({
      period: '7d',
      genre: 'Death Metal',
      country: 'se',
      type: 'album',
      sort: 'newest',
      page: 1,
      limit: 1,
      currentDate: new Date('2026-07-01T12:00:00.000Z'),
    });

    expect(result.items.map((release) => release.id)).toEqual(['match-1']);
    expect(result.pagination).toEqual({
      page: 1,
      limit: 1,
      total: 2,
      hasNextPage: true,
    });
  });

  it('sorts by less popular without filtering out null popularity', async () => {
    const repository = new InMemoryReleaseRepository();

    await repository.saveReleases([
      makeRelease({ id: 'unknown-popularity', releaseDate: '2026-06-30', popularity: null }),
      makeRelease({ id: 'less-known', releaseDate: '2026-06-30', popularity: 59 }),
    ]);

    const result = await repository.findReleases({
      period: '7d',
      type: 'all',
      sort: 'less-popular',
      currentDate: new Date('2026-07-01T12:00:00.000Z'),
    });

    expect(result.items.map((release) => release.id)).toEqual(['less-known', 'unknown-popularity']);
  });

  it('sorts releases before pagination by date', async () => {
    const repository = new InMemoryReleaseRepository();

    await repository.saveReleases([
      makeRelease({ id: 'older-popular', releaseDate: '2026-06-29', popularity: 100 }),
      makeRelease({ id: 'newer-null', releaseDate: '2026-06-30', popularity: null }),
      makeRelease({ id: 'newer-less-popular', releaseDate: '2026-06-30', popularity: 40 }),
      makeRelease({ id: 'newer-more-popular', releaseDate: '2026-06-30', popularity: 80 }),
    ]);

    const result = await repository.findReleases({
      period: '7d',
      type: 'all',
      sort: 'newest',
      page: 1,
      limit: 3,
      currentDate: new Date('2026-07-01T12:00:00.000Z'),
    });

    expect(result.items.map((release) => release.id)).toEqual(['newer-less-popular', 'newer-more-popular', 'newer-null']);
    expect(result.pagination).toEqual({
      page: 1,
      limit: 3,
      total: 4,
      hasNextPage: true,
    });
  });

  it('starts from a stable random offset when a random seed is provided', async () => {
    const repository = new InMemoryReleaseRepository();

    await repository.saveReleases([
      makeRelease({ id: 'release-1', releaseDate: '2026-06-30' }),
      makeRelease({ id: 'release-2', releaseDate: '2026-06-29' }),
      makeRelease({ id: 'release-3', releaseDate: '2026-06-28' }),
      makeRelease({ id: 'release-4', releaseDate: '2026-06-27' }),
    ]);

    const firstPage = await repository.findReleases({
      period: '7d',
      type: 'all',
      sort: 'newest',
      page: 1,
      limit: 2,
      randomStartSeed: 'seed-1',
      currentDate: new Date('2026-07-01T12:00:00.000Z'),
    });
    const secondPage = await repository.findReleases({
      period: '7d',
      type: 'all',
      sort: 'newest',
      page: 2,
      limit: 2,
      randomStartSeed: 'seed-1',
      currentDate: new Date('2026-07-01T12:00:00.000Z'),
    });

    expect(firstPage.pagination.total).toBe(4);
    expect(firstPage.items.map((release) => release.id)).not.toEqual(['release-1', 'release-2']);
    expect(secondPage.items.length).toBeLessThanOrEqual(2);
  });

  it('cleans up old day-precision releases', async () => {
    const repository = new InMemoryReleaseRepository();

    await repository.saveReleases([
      makeRelease({ id: 'old', releaseDate: '2026-05-30' }),
      makeRelease({ id: 'fresh', releaseDate: '2026-06-15' }),
    ]);

    await expect(repository.cleanupOldReleases(new Date('2026-07-01T12:00:00.000Z'), 30)).resolves.toEqual({ deleted: 1 });

    const result = await repository.findReleases({
      period: '1m',
      type: 'all',
      sort: 'newest',
      currentDate: new Date('2026-07-01T12:00:00.000Z'),
    });

    expect(result.items.map((release) => release.id)).toEqual(['fresh']);
  });

  it('lists active genres with release counts', async () => {
    const repository = new InMemoryReleaseRepository();

    await repository.saveReleases([
      makeRelease({ id: 'first', genres: ['Techno', 'ambient'] }),
      makeRelease({ id: 'second', genres: ['techno'] }),
      makeRelease({ id: 'third', genres: [] }),
    ]);

    await repository.cleanupOldReleases(new Date('2026-07-01T12:00:00.000Z'), 30);

    await expect(repository.listActiveGenres()).resolves.toEqual([
      { genre: 'ambient', releaseCount: 1, kind: 'general' },
      { genre: 'techno', releaseCount: 2, kind: 'general' },
      { genre: '__no_genre__', releaseCount: 1, kind: 'missing' },
    ]);
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
