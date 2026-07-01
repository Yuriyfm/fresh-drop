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
});
