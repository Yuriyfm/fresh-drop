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
      popularity: 'all',
      currentDate: new Date('2026-07-01T12:00:00.000Z'),
    });

    expect(result.pagination.total).toBe(1);
    expect(result.items[0].title).toBe('New title');
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
      popularity: 'popular',
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

  it('does not include null popularity in popularity buckets', async () => {
    const repository = new InMemoryReleaseRepository();

    await repository.saveReleases([
      makeRelease({ id: 'unknown-popularity', releaseDate: '2026-06-30', popularity: null }),
      makeRelease({ id: 'less-known', releaseDate: '2026-06-30', popularity: 59 }),
    ]);

    const lessKnownResult = await repository.findReleases({
      period: '7d',
      type: 'all',
      popularity: 'less-known',
      currentDate: new Date('2026-07-01T12:00:00.000Z'),
    });
    const allResult = await repository.findReleases({
      period: '7d',
      type: 'all',
      popularity: 'all',
      currentDate: new Date('2026-07-01T12:00:00.000Z'),
    });

    expect(lessKnownResult.items.map((release) => release.id)).toEqual(['less-known']);
    expect(allResult.items.map((release) => release.id)).toEqual(['less-known', 'unknown-popularity']);
  });

  it('sorts releases before pagination by date, popularity, and known popularity first', async () => {
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
      popularity: 'all',
      page: 1,
      limit: 3,
      currentDate: new Date('2026-07-01T12:00:00.000Z'),
    });

    expect(result.items.map((release) => release.id)).toEqual(['newer-more-popular', 'newer-less-popular', 'newer-null']);
    expect(result.pagination).toEqual({
      page: 1,
      limit: 3,
      total: 4,
      hasNextPage: true,
    });
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
      popularity: 'all',
      currentDate: new Date('2026-07-01T12:00:00.000Z'),
    });

    expect(result.items.map((release) => release.id)).toEqual(['fresh']);
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
