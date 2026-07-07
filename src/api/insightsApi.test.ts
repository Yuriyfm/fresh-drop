import { describe, expect, it, vi } from 'vitest';
import type { Release } from '../domain/release';
import { getInsightsApiResponse } from './insightsApi';

describe('getInsightsApiResponse', () => {
  it('uses default insights query parameters', async () => {
    const repository = {
      listInsightsReleases: vi.fn().mockResolvedValue([]),
    };
    const currentDate = new Date('2026-07-07T00:00:00.000Z');

    const response = await getInsightsApiResponse(repository, {}, { currentDate });

    expect(repository.listInsightsReleases).toHaveBeenCalledWith({
      period: '1m',
      type: 'all',
      sort: 'newest',
      currentDate,
    });
    expect(response).toMatchObject({
      period: 30,
      type: 'all',
      generatedAt: '2026-07-07T00:00:00.000Z',
      error: null,
    });
  });

  it('normalizes period and type for insight cards', async () => {
    const repository = {
      listInsightsReleases: vi.fn().mockResolvedValue([
        makeRelease({ id: 'single-1', country: 'Brazil', genres: ['funk'], popularity: 75 }),
      ]),
    };

    const response = await getInsightsApiResponse(repository, { period: '7', type: 'single' }, {
      currentDate: new Date('2026-07-07T00:00:00.000Z'),
    });

    expect(repository.listInsightsReleases).toHaveBeenCalledWith({
      period: '7d',
      type: 'single',
      sort: 'newest',
      currentDate: new Date('2026-07-07T00:00:00.000Z'),
    });
    expect(response.error).toBeNull();
    expect(response.sections.countries.mostActiveCountries.byReleases[0]).toMatchObject({
      title: 'Brazil',
      query: { country: 'Brazil' },
    });
  });

  it('returns invalid_query for unsupported period or type', async () => {
    const repository = {
      listInsightsReleases: vi.fn(),
    };

    const response = await getInsightsApiResponse(repository, { period: '1m', type: 'compilation' });

    expect(response.error).toMatchObject({
      code: 'invalid_query',
    });
    expect(repository.listInsightsReleases).not.toHaveBeenCalled();
  });
});

function makeRelease(overrides: Partial<Release> = {}): Release {
  const artist = {
    id: 'artist-1',
    name: 'Artist One',
    genres: overrides.genres ?? ['pop'],
    country: 'unknown' as const,
    popularity: overrides.popularity ?? 70,
  };

  return {
    id: 'release-1',
    spotifyUrl: 'https://open.spotify.com/album/release-1',
    coverUrl: null,
    title: 'Release One',
    artists: [artist],
    primaryArtist: artist,
    type: 'single',
    releaseDate: '2026-07-01',
    releaseDatePrecision: 'day',
    genres: ['pop'],
    country: 'Brazil',
    popularity: 70,
    ...overrides,
  };
}
