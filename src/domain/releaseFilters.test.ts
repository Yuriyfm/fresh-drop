import { describe, expect, it } from 'vitest';
import type { Release } from './release';
import { filterReleases, matchesPopularity } from './releaseFilters';

const currentDate = new Date('2026-06-28T12:00:00.000Z');

function makeRelease(overrides: Partial<Release>): Release {
  const artist = {
    id: 'artist-1',
    name: 'Artist',
    genres: ['indie pop'],
    country: 'unknown' as const,
    popularity: 50,
  };

  return {
    id: 'release-1',
    spotifyUrl: null,
    coverUrl: null,
    title: 'Release',
    artists: [artist],
    primaryArtist: artist,
    type: 'single',
    releaseDate: '2026-06-28',
    releaseDatePrecision: 'day',
    genres: ['indie pop'],
    country: 'unknown',
    popularity: 50,
    ...overrides,
  };
}

describe('filterReleases', () => {
  it('filters releases by the selected period', () => {
    const releases = [
      makeRelease({ id: 'fresh', releaseDate: '2026-06-24' }),
      makeRelease({ id: 'old', releaseDate: '2026-06-10' }),
    ];

    const result = filterReleases(releases, {
      period: '7d',
      type: 'all',
      popularity: 'all',
      currentDate,
    });

    expect(result.map((release) => release.id)).toEqual(['fresh']);
  });

  it('excludes imprecise dates from period filters', () => {
    const result = filterReleases(
      [makeRelease({ releaseDate: '2026-06', releaseDatePrecision: 'month' })],
      {
        period: '1m',
        type: 'all',
        popularity: 'all',
        currentDate,
      },
    );

    expect(result).toEqual([]);
  });

  it('filters by genre, country, type, and popularity', () => {
    const releases = [
      makeRelease({
        id: 'match',
        genres: ['techno'],
        country: 'DE',
        type: 'album',
        popularity: 80,
      }),
      makeRelease({
        id: 'wrong-genre',
        genres: ['ambient'],
        country: 'DE',
        type: 'album',
        popularity: 80,
      }),
    ];

    const result = filterReleases(releases, {
      period: '14d',
      genre: 'Techno',
      country: 'de',
      type: 'album',
      popularity: 'popular',
      currentDate,
    });

    expect(result.map((release) => release.id)).toEqual(['match']);
  });
});

describe('matchesPopularity', () => {
  it('treats null popularity as less-known, not popular', () => {
    const release = makeRelease({ popularity: null });

    expect(matchesPopularity(release, 'popular')).toBe(false);
    expect(matchesPopularity(release, 'less-known')).toBe(true);
  });
});
