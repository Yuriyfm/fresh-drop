import { describe, expect, it } from 'vitest';
import type { ArtistSummary, Release } from '../domain/release';
import { buildSpotifyArtistUrl, extractUniqueSpotifyArtistsFromReleases } from './artistEnrichment';

describe('artistEnrichment helpers', () => {
  it('builds a Spotify artist URL', () => {
    expect(buildSpotifyArtistUrl('artist-123')).toBe('https://open.spotify.com/artist/artist-123');
  });

  it('extracts unique artists from releases by spotify artist id', () => {
    const artistOne = makeArtist({ id: 'artist-1', name: 'Artist One' });
    const artistOneUpdated = makeArtist({ id: 'artist-1', name: 'Artist One Updated' });
    const artistTwo = makeArtist({ id: 'artist-2', name: 'Artist Two' });

    expect(extractUniqueSpotifyArtistsFromReleases([
      makeRelease({ id: 'release-1', artists: [artistOne, artistTwo], primaryArtist: artistOne }),
      makeRelease({ id: 'release-2', artists: [artistOneUpdated], primaryArtist: artistOneUpdated }),
    ])).toEqual([
      {
        spotifyArtistId: 'artist-1',
        spotifyArtistName: 'Artist One Updated',
        spotifyArtistUrl: 'https://open.spotify.com/artist/artist-1',
      },
      {
        spotifyArtistId: 'artist-2',
        spotifyArtistName: 'Artist Two',
        spotifyArtistUrl: 'https://open.spotify.com/artist/artist-2',
      },
    ]);
  });
});

function makeRelease(overrides: Partial<Release>): Release {
  const artist = makeArtist();
  const artists = overrides.artists ?? [artist];

  return {
    id: 'release-1',
    spotifyUrl: null,
    coverUrl: null,
    title: 'Release',
    artists,
    primaryArtist: overrides.primaryArtist ?? artists[0] ?? null,
    type: 'single',
    releaseDate: '2026-07-01',
    releaseDatePrecision: 'day',
    genres: ['pop'],
    country: 'unknown',
    popularity: 50,
    ...overrides,
  };
}

function makeArtist(overrides: Partial<ArtistSummary> = {}): ArtistSummary {
  return {
    id: 'artist-1',
    name: 'Artist One',
    genres: ['pop'],
    country: 'unknown',
    popularity: 50,
    ...overrides,
  };
}
