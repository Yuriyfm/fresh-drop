import { describe, expect, it, vi } from 'vitest';
import {
  MusicBrainzClient,
  MusicBrainzApiError,
  parseMusicBrainzRetryAfterMs,
  parseMusicBrainzUrlLookupResults,
} from './musicbrainzClient';

describe('parseMusicBrainzUrlLookupResults', () => {
  it('parses a matched URL lookup result', () => {
    expect(parseMusicBrainzUrlLookupResults(
      ['https://open.spotify.com/artist/artist-1'],
      {
        resource: 'https://open.spotify.com/artist/artist-1',
        relations: [{
          'target-type': 'artist',
          artist: { id: 'mbid-1', name: 'Artist One' },
        }],
      },
    )).toEqual([{
      spotifyArtistUrl: 'https://open.spotify.com/artist/artist-1',
      status: 'matched',
      musicBrainzArtistMbid: 'mbid-1',
      musicBrainzArtistName: 'Artist One',
    }]);
  });

  it('marks missing URL lookup results as not_found', () => {
    expect(parseMusicBrainzUrlLookupResults(
      ['https://open.spotify.com/artist/artist-1'],
      { urls: [] },
    )).toEqual([{
      spotifyArtistUrl: 'https://open.spotify.com/artist/artist-1',
      status: 'not_found',
    }]);
  });

  it('marks ambiguous URL lookup results', () => {
    expect(parseMusicBrainzUrlLookupResults(
      ['https://open.spotify.com/artist/artist-1'],
      {
        resource: 'https://open.spotify.com/artist/artist-1',
        relations: [
          { 'target-type': 'artist', artist: { id: 'mbid-1', name: 'Artist One' } },
          { 'target-type': 'artist', artist: { id: 'mbid-2', name: 'Artist Two' } },
        ],
      },
    )).toEqual([{
      spotifyArtistUrl: 'https://open.spotify.com/artist/artist-1',
      status: 'ambiguous',
    }]);
  });
});

describe('MusicBrainzClient', () => {
  it('sends a contacted user agent and batches Spotify URLs as repeated resources', async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ urls: [] }),
    } as Response);
    const client = new MusicBrainzClient({
      baseUrl: 'https://musicbrainz.org/ws/2',
      userAgent: 'FreshDrop/0.1.0 (https://github.com/Yuriyfm/fresh-drop)',
      rateLimitMs: 1100,
      fetchFn,
    });
    const urls = [
      'https://open.spotify.com/artist/artist-1',
      'https://open.spotify.com/artist/artist-2',
    ];

    await client.lookupSpotifyArtistUrls(urls);

    const [requestUrl, init] = fetchFn.mock.calls[0] as [URL, RequestInit];
    expect(requestUrl.pathname).toBe('/ws/2/url');
    expect(requestUrl.searchParams.getAll('resource')).toEqual(urls);
    expect(init.headers).toMatchObject({
      'User-Agent': 'FreshDrop/0.1.0 (https://github.com/Yuriyfm/fresh-drop)',
      Accept: 'application/json',
    });
  });

  it('looks up artist genres', async () => {
    const client = new MusicBrainzClient({
      baseUrl: 'https://musicbrainz.org/ws/2',
      userAgent: 'FreshDrop/0.1.0 (test@example.com)',
      rateLimitMs: 1100,
      fetchFn: async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          name: 'Artist One',
          area: { name: 'United States' },
          country: 'US',
          genres: [
            { id: '1', name: 'pop', count: 3 },
            { id: '2', name: 'pop rock', count: 2 },
          ],
        }),
      }) as Response,
    });

    await expect(client.lookupArtistGenres('mbid-1')).resolves.toEqual({
      musicBrainzArtistMbid: 'mbid-1',
      musicBrainzArtistName: 'Artist One',
      musicBrainzArtistCountry: 'United States',
      genres: [
        { id: '1', name: 'pop', count: 3, source: 'musicbrainz' },
        { id: '2', name: 'pop rock', count: 2, source: 'musicbrainz' },
      ],
    });
  });

  it('falls back to the ISO country code when area name is missing', async () => {
    const client = new MusicBrainzClient({
      baseUrl: 'https://musicbrainz.org/ws/2',
      userAgent: 'FreshDrop/0.1.0 (test@example.com)',
      rateLimitMs: 1100,
      fetchFn: async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          name: 'Artist One',
          country: 'GB',
          genres: [],
        }),
      }) as Response,
    });

    await expect(client.lookupArtistGenres('mbid-1')).resolves.toMatchObject({
      musicBrainzArtistCountry: 'United Kingdom',
    });
  });

  it('prefers the ISO country code over a city-level area name', async () => {
    const client = new MusicBrainzClient({
      baseUrl: 'https://musicbrainz.org/ws/2',
      userAgent: 'FreshDrop/0.1.0 (test@example.com)',
      rateLimitMs: 1100,
      fetchFn: async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          name: 'Artist One',
          area: { name: 'Berlin' },
          country: 'DE',
          genres: [],
        }),
      }) as Response,
    });

    await expect(client.lookupArtistGenres('mbid-1')).resolves.toMatchObject({
      musicBrainzArtistCountry: 'Germany',
    });
  });

  it('ignores a city-level area name when no country code is present', async () => {
    const client = new MusicBrainzClient({
      baseUrl: 'https://musicbrainz.org/ws/2',
      userAgent: 'FreshDrop/0.1.0 (test@example.com)',
      rateLimitMs: 1100,
      fetchFn: async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          name: 'Artist One',
          area: { name: 'Berlin' },
          genres: [],
        }),
      }) as Response,
    });

    await expect(client.lookupArtistGenres('mbid-1')).resolves.toMatchObject({
      musicBrainzArtistCountry: undefined,
    });
  });

  it('treats 503 as a retryable API error', async () => {
    const client = new MusicBrainzClient({
      baseUrl: 'https://musicbrainz.org/ws/2',
      userAgent: 'FreshDrop/0.1.0 (test@example.com)',
      rateLimitMs: 1100,
      fetchFn: async () => ({
        ok: false,
        status: 503,
        headers: new Headers({ 'Retry-After': '120' }),
        json: async () => ({}),
      }) as Response,
    });

    await expect(client.lookupArtistGenres('mbid-1')).rejects.toMatchObject({
      status: 503,
      retryable: true,
      retryAfterMs: 120_000,
    });
  });
});

describe('parseMusicBrainzRetryAfterMs', () => {
  it('parses seconds and HTTP dates', () => {
    const now = new Date('2026-07-05T12:00:00.000Z');

    expect(parseMusicBrainzRetryAfterMs('12', now)).toBe(12_000);
    expect(parseMusicBrainzRetryAfterMs('Sun, 05 Jul 2026 12:02:00 GMT', now)).toBe(120_000);
    expect(parseMusicBrainzRetryAfterMs('invalid', now)).toBeNull();
  });
});
