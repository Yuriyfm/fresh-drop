import type { ArtistSummary, Release, ReleaseDatePrecision, ReleaseType } from '../domain/release';
import type { SpotifyAlbumDto, SpotifyArtistDto } from './spotifyTypes';

export function mapSpotifyAlbumToRelease(album: SpotifyAlbumDto): Release | null {
  if (!album.id || !album.name) {
    return null;
  }

  const artists = (album.artists ?? []).map(mapSpotifyArtist);
  const primaryArtist = artists[0] ?? null;

  return {
    id: album.id,
    spotifyUrl: album.external_urls?.spotify ?? null,
    coverUrl: album.images?.[0]?.url ?? null,
    title: album.name,
    artists,
    primaryArtist,
    type: mapReleaseType(album.album_type),
    releaseDate: album.release_date ?? '',
    releaseDatePrecision: mapReleaseDatePrecision(album.release_date_precision),
    genres: normalizeGenres(artists.flatMap((artist) => artist.genres)),
    country: primaryArtist?.country ?? 'unknown',
    popularity: primaryArtist?.popularity ?? null,
  };
}

export function enrichSpotifyAlbumArtists(
  album: SpotifyAlbumDto,
  artistsById: ReadonlyMap<string, SpotifyArtistDto>,
): SpotifyAlbumDto {
  return {
    ...album,
    artists: (album.artists ?? []).map((artist) => {
      const enrichedArtist = artist.id ? artistsById.get(artist.id) : undefined;

      return {
        ...artist,
        ...enrichedArtist,
      };
    }),
  };
}

function mapSpotifyArtist(artist: SpotifyArtistDto): ArtistSummary {
  return {
    id: artist.id ?? '',
    name: artist.name ?? '',
    genres: normalizeGenres(artist.genres ?? []),
    country: 'unknown',
    popularity: typeof artist.popularity === 'number' ? artist.popularity : null,
  };
}

function mapReleaseType(value?: string): ReleaseType {
  if (value === 'single' || value === 'album' || value === 'compilation') {
    return value;
  }

  return 'unknown';
}

function mapReleaseDatePrecision(value?: string): ReleaseDatePrecision {
  if (value === 'year' || value === 'month' || value === 'day') {
    return value;
  }

  return 'unknown';
}

function normalizeGenres(genres: string[]): string[] {
  return Array.from(
    new Set(
      genres
        .map((genre) => genre.trim().toLowerCase())
        .filter((genre) => genre.length > 0),
    ),
  );
}
