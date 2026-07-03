import { describe, expect, it } from 'vitest';
import type { Release } from './release';
import { filterReleases, matchesPeriod, sortReleasesForSearch } from './releaseFilters';

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
      sort: 'newest',
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
        sort: 'newest',
        currentDate,
      },
    );

    expect(result).toEqual([]);
  });

  it('filters by genre, country, and type', () => {
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
      sort: 'newest',
      currentDate,
    });

    expect(result.map((release) => release.id)).toEqual(['match']);
  });
});

describe('sortReleasesForSearch', () => {
  it('sorts newest releases first by default', () => {
    const releases = [
      makeRelease({ id: 'older', releaseDate: '2026-06-27', popularity: 95 }),
      makeRelease({ id: 'newer-b', releaseDate: '2026-06-28', popularity: 30 }),
      makeRelease({ id: 'newer-a', releaseDate: '2026-06-28', popularity: 80 }),
    ];

    const result = sortReleasesForSearch(releases);

    expect(result.map((release) => release.id)).toEqual(['newer-a', 'newer-b', 'older']);
  });

  it('sorts oldest releases first', () => {
    const releases = [
      makeRelease({ id: 'newer', releaseDate: '2026-06-28' }),
      makeRelease({ id: 'older', releaseDate: '2026-06-01' }),
    ];

    const result = sortReleasesForSearch(releases, 'oldest');

    expect(result.map((release) => release.id)).toEqual(['older', 'newer']);
  });

  it('sorts by popularity without date as the primary order', () => {
    const releases = [
      makeRelease({ id: 'older-popular', releaseDate: '2026-06-01', popularity: 95 }),
      makeRelease({ id: 'newer-less-popular', releaseDate: '2026-06-28', popularity: 30 }),
      makeRelease({ id: 'unknown-popularity', releaseDate: '2026-06-28', popularity: null }),
    ];

    expect(sortReleasesForSearch(releases, 'popular').map((release) => release.id)).toEqual([
      'older-popular',
      'newer-less-popular',
      'unknown-popularity',
    ]);
    expect(sortReleasesForSearch(releases, 'less-popular').map((release) => release.id)).toEqual([
      'newer-less-popular',
      'older-popular',
      'unknown-popularity',
    ]);
  });

  it('puts imprecise or invalid dates below precise release dates', () => {
    const releases = [
      makeRelease({ id: 'imprecise-date', releaseDate: '2026-06', releaseDatePrecision: 'month', popularity: 100 }),
      makeRelease({ id: 'invalid-date', releaseDate: 'not-a-date', popularity: 100 }),
      makeRelease({ id: 'precise-date', releaseDate: '2026-06-01', popularity: 1 }),
    ];

    const result = sortReleasesForSearch(releases);

    expect(result.map((release) => release.id)).toEqual(['precise-date', 'imprecise-date', 'invalid-date']);
  });
});

describe('matchesPeriod', () => {
  it('includes releases on the selected period boundary', () => {
    const release = makeRelease({ releaseDate: '2026-06-21' });

    expect(matchesPeriod(release, '7d', currentDate)).toBe(true);
  });

  it('excludes releases older than the selected period boundary', () => {
    const release = makeRelease({ releaseDate: '2026-06-20' });

    expect(matchesPeriod(release, '7d', currentDate)).toBe(false);
  });

  it('excludes future release dates', () => {
    const release = makeRelease({ releaseDate: '2026-06-29' });

    expect(matchesPeriod(release, '7d', currentDate)).toBe(false);
  });

  it('excludes invalid date strings', () => {
    const release = makeRelease({ releaseDate: 'not-a-date' });

    expect(matchesPeriod(release, '7d', currentDate)).toBe(false);
  });
});
