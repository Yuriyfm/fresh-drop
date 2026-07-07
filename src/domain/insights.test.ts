import { describe, expect, it } from 'vitest';
import type { Release } from './release';
import { createInsightsData } from './insights';

describe('createInsightsData', () => {
  it('builds clickable country, genre, scene, and discovery slices', () => {
    const releases = [
      makeRelease({ id: 'de-techno-1', country: 'DE', genres: ['Techno'], popularity: 70 }),
      makeRelease({ id: 'de-techno-2', country: 'Germany', genres: ['Techno'], popularity: 68, artistId: 'artist-2' }),
      makeRelease({ id: 'pl-metal', country: 'Poland', genres: ['Death Metal'], popularity: 12, artistId: 'artist-3' }),
      makeRelease({ id: 'unknown', country: 'unknown', genres: ['unknown'], popularity: 5, artistId: 'artist-4' }),
    ];

    const data = createInsightsData({
      releases,
      period: 30,
      type: 'all',
      generatedAt: new Date('2026-07-07T00:00:00.000Z'),
    });

    expect(data.generatedAt).toBe('2026-07-07T00:00:00.000Z');
    expect(data.sections.countries.mostActiveCountries.byReleases[0]).toMatchObject({
      title: 'Germany',
      metric: '2 releases',
      description: '2 artists',
      query: { country: 'Germany' },
    });
    expect(data.sections.genres.mostActiveGenres[0]).toMatchObject({
      title: 'techno',
      metric: '2 releases',
      query: { genre: 'techno' },
    });
    expect(data.sections.discovery.deepUndergroundDrops.map((item) => item.title)).toContain('Release pl-metal');
    expect(data.sections.countries.mostActiveCountries.byReleases.some((item) => item.title === 'unknown')).toBe(false);
  });

  it('links big artists from small scenes to their latest matching release', () => {
    const activeCountryReleases = Array.from({ length: 10 }, (_, countryIndex) =>
      Array.from({ length: 3 }, (_, releaseIndex) =>
        makeRelease({
          id: `active-${countryIndex}-${releaseIndex}`,
          country: `Active ${countryIndex}`,
          popularity: 55,
          artistId: `active-artist-${countryIndex}-${releaseIndex}`,
        }),
      ),
    ).flat();
    const releases = [
      ...activeCountryReleases,
      makeRelease({
        id: 'small-scene-old',
        title: 'Old Small Scene Release',
        country: 'Poland',
        popularity: 82,
        releaseDate: '2026-07-01',
        artistId: 'small-scene-artist',
        artistName: 'Scene Star',
      }),
      makeRelease({
        id: 'small-scene-new',
        title: 'New Small Scene Release',
        country: 'Poland',
        popularity: 80,
        releaseDate: '2026-07-06',
        artistId: 'small-scene-artist',
        artistName: 'Scene Star',
      }),
    ];

    const data = createInsightsData({
      releases,
      period: 30,
      type: 'all',
      generatedAt: new Date('2026-07-07T00:00:00.000Z'),
    });

    expect(data.sections.countries.bigArtistsFromSmallScenes[0]).toMatchObject({
      title: 'Scene Star',
      metric: 'popularity 80 · latest release: New Small Scene Release',
      description: 'Poland',
      query: {
        releaseId: 'small-scene-new',
        country: 'Poland',
        popularityMin: 50,
      },
      release: {
        id: 'small-scene-new',
        title: 'New Small Scene Release',
      },
    });
    expect(data.sections.countries.bigArtistsFromSmallScenes.filter((item) => item.title === 'Scene Star')).toHaveLength(1);
  });
});

function makeRelease(overrides: Partial<Release> & { artistId?: string; artistName?: string } = {}): Release {
  const artist = {
    id: overrides.artistId ?? 'artist-1',
    name: overrides.artistName ?? `Artist ${overrides.artistId ?? '1'}`,
    genres: overrides.genres ?? ['techno'],
    country: 'unknown' as const,
    popularity: overrides.popularity ?? 50,
  };
  const id = overrides.id ?? 'release-1';

  return {
    id,
    spotifyUrl: `https://open.spotify.com/album/${id}`,
    coverUrl: null,
    title: `Release ${id}`,
    artists: [artist],
    primaryArtist: artist,
    type: 'single',
    releaseDate: '2026-07-01',
    releaseDatePrecision: 'day',
    genres: ['techno'],
    country: 'Germany',
    popularity: 50,
    ...overrides,
  };
}
