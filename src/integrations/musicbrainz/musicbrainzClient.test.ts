import { describe, expect, it } from 'vitest';
import { MusicBrainzClient, MusicBrainzApiError, parseMusicBrainzUrlLookupResults } from './musicbrainzClient';

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

  it('treats 503 as a retryable API error', async () => {
    const client = new MusicBrainzClient({
      baseUrl: 'https://musicbrainz.org/ws/2',
      userAgent: 'FreshDrop/0.1.0 (test@example.com)',
      rateLimitMs: 1100,
      fetchFn: async () => ({
        ok: false,
        status: 503,
        json: async () => ({}),
      }) as Response,
    });

    await expect(client.lookupArtistGenres('mbid-1')).rejects.toMatchObject({
      status: 503,
      retryable: true,
    });
  });
});
