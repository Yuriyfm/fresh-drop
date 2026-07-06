import { describe, expect, it, vi } from 'vitest';
import type { Release } from './domain/release';
import { fetchReleases, ReleasesClientError } from './releasesClient';

describe('fetchReleases', () => {
  it('requests GET /api/releases with MVP filters and pagination', async () => {
    const release = makeRelease();
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          items: [release],
          genres: [{ name: 'indie pop', releaseCount: 1, kind: 'exact' }],
          pagination: {
            page: 2,
            limit: 20,
            total: 21,
            hasNextPage: false,
          },
          error: null,
        }),
      ),
    );

    const response = await fetchReleases(
      {
        period: '14d',
        genres: ['indie pop', 'pop'],
        country: 'Sweden',
        type: 'single',
        sort: 'popular',
        page: 2,
        limit: 20,
      },
      { fetchFn },
    );

    expect(fetchFn).toHaveBeenCalledWith(
      '/api/releases?period=14d&type=single&sort=popular&page=2&limit=20&genre=indie+pop&genre=pop&country=Sweden',
      expect.objectContaining({
        headers: {
          Accept: 'application/json',
        },
      }),
    );
    expect(response.items).toEqual([release]);
  });

  it('throws the API error message when the backend returns an error payload', async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
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
            message: 'Invalid period query parameter.',
          },
        }),
        { status: 400 },
      ),
    );

    await expect(
      fetchReleases(
        {
          period: '7d',
          type: 'all',
          sort: 'newest',
          page: 1,
          limit: 20,
        },
        { fetchFn },
      ),
    ).rejects.toEqual(new ReleasesClientError('Invalid period query parameter.', 'invalid_query'));
  });
});

function makeRelease(overrides: Partial<Release> = {}): Release {
  const artist = {
    id: 'artist-1',
    name: 'Artist One',
    genres: ['indie pop'],
    country: 'SE' as const,
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
    genres: ['indie pop'],
    country: 'SE',
    popularity: 70,
    ...overrides,
  };
}
