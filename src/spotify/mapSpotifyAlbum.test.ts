import { describe, expect, it } from 'vitest';
import { mapSpotifyAlbumToRelease } from './mapSpotifyAlbum';

describe('mapSpotifyAlbumToRelease', () => {
  it('maps Spotify album DTO to the release domain model', () => {
    const release = mapSpotifyAlbumToRelease({
      id: 'album-1',
      name: 'New Album',
      album_type: 'album',
      release_date: '2026-06-28',
      release_date_precision: 'day',
      external_urls: { spotify: 'https://open.spotify.com/album/album-1' },
      images: [{ url: 'https://image.example/cover.jpg' }],
      artists: [
        {
          id: 'artist-1',
          name: 'Artist One',
          genres: ['Indie Rock', ' indie rock ', 'Pop'],
          popularity: 71,
        },
      ],
    });

    expect(release).toEqual({
      id: 'album-1',
      spotifyUrl: 'https://open.spotify.com/album/album-1',
      coverUrl: 'https://image.example/cover.jpg',
      title: 'New Album',
      artists: [
        {
          id: 'artist-1',
          name: 'Artist One',
          genres: ['indie rock', 'pop'],
          country: 'unknown',
          popularity: 71,
        },
      ],
      primaryArtist: {
        id: 'artist-1',
        name: 'Artist One',
        genres: ['indie rock', 'pop'],
        country: 'unknown',
        popularity: 71,
      },
      type: 'album',
      releaseDate: '2026-06-28',
      releaseDatePrecision: 'day',
      genres: ['indie rock', 'pop'],
      country: 'unknown',
      popularity: 71,
    });
  });

  it('returns null when required release fields are missing', () => {
    expect(mapSpotifyAlbumToRelease({ name: 'Missing ID' })).toBeNull();
    expect(mapSpotifyAlbumToRelease({ id: 'missing-name' })).toBeNull();
  });

  it('maps known Spotify album types to release types', () => {
    expect(makeReleaseType('single')).toBe('single');
    expect(makeReleaseType('album')).toBe('album');
    expect(makeReleaseType('compilation')).toBe('compilation');
  });

  it('maps unknown Spotify album types to unknown', () => {
    expect(makeReleaseType('appears_on')).toBe('unknown');
    expect(makeReleaseType(undefined)).toBe('unknown');
  });

  it('maps missing optional release fields to safe domain defaults', () => {
    const release = mapSpotifyAlbumToRelease({
      id: 'album-2',
      name: 'Sparse Album',
      artists: [],
    });

    expect(release).toMatchObject({
      spotifyUrl: null,
      coverUrl: null,
      artists: [],
      primaryArtist: null,
      genres: [],
      country: 'unknown',
      popularity: null,
      releaseDate: '',
      releaseDatePrecision: 'unknown',
    });
  });

  it('maps release date precision values from Spotify', () => {
    expect(makeReleaseDatePrecision('year')).toBe('year');
    expect(makeReleaseDatePrecision('month')).toBe('month');
    expect(makeReleaseDatePrecision('day')).toBe('day');
    expect(makeReleaseDatePrecision('invalid')).toBe('unknown');
    expect(makeReleaseDatePrecision(undefined)).toBe('unknown');
  });

  it('maps artists without genres or popularity without inventing data', () => {
    const release = mapSpotifyAlbumToRelease({
      id: 'album-3',
      name: 'Artist Edge Cases',
      artists: [{ id: 'artist-2', name: 'Artist Two' }],
    });

    expect(release?.artists).toEqual([
      {
        id: 'artist-2',
        name: 'Artist Two',
        genres: [],
        country: 'unknown',
        popularity: null,
      },
    ]);
    expect(release?.genres).toEqual([]);
    expect(release?.popularity).toBeNull();
  });
});

function makeReleaseType(albumType: string | undefined) {
  return mapSpotifyAlbumToRelease({
    id: `release-${albumType ?? 'missing'}`,
    name: 'Release',
    album_type: albumType,
  })?.type;
}

function makeReleaseDatePrecision(precision: string | undefined) {
  return mapSpotifyAlbumToRelease({
    id: `release-${precision ?? 'missing'}`,
    name: 'Release',
    release_date_precision: precision,
  })?.releaseDatePrecision;
}
