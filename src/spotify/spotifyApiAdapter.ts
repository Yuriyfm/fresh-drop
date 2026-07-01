import type { Release } from '../domain/release';
import { mapSpotifyAlbumToRelease } from './mapSpotifyAlbum';
import type {
  SpotifyAlbumDto,
  SpotifyArtistDto,
  SpotifyArtistsResponseDto,
  SpotifySearchAlbumsResponseDto,
  SpotifyTokenResponseDto,
} from './spotifyTypes';

const SPOTIFY_ACCOUNTS_URL = 'https://accounts.spotify.com/api/token';
const SPOTIFY_API_URL = 'https://api.spotify.com/v1';
const MAX_SEARCH_LIMIT = 50;
const MAX_ARTIST_IDS_PER_REQUEST = 50;

type FetchLike = typeof fetch;

export type SpotifyApiAdapterConfig = {
  clientId: string;
  clientSecret: string;
  fetchFn?: FetchLike;
};

export type FetchFreshReleasesFromSpotifyOptions = {
  limit?: number;
  market?: string;
  pages?: number;
};

export type SpotifyApiErrorCode = 'auth' | 'rate_limited' | 'api' | 'network' | 'invalid_response';

export class SpotifyApiError extends Error {
  readonly code: SpotifyApiErrorCode;
  readonly status: number | null;
  readonly retryAfterSeconds: number | null;

  constructor(message: string, code: SpotifyApiErrorCode, status: number | null = null, retryAfterSeconds: number | null = null) {
    super(message);
    this.name = 'SpotifyApiError';
    this.code = code;
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export class SpotifyApiAdapter {
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly fetchFn: FetchLike;
  private token: { value: string; expiresAt: number } | null = null;

  constructor(config: SpotifyApiAdapterConfig) {
    this.clientId = config.clientId;
    this.clientSecret = config.clientSecret;
    this.fetchFn = config.fetchFn ?? fetch;
  }

  async getAppAccessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now()) {
      return this.token.value;
    }

    const response = await this.request(SPOTIFY_ACCOUNTS_URL, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${encodeBasicAuth(this.clientId, this.clientSecret)}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ grant_type: 'client_credentials' }),
    });

    const token = (await response.json()) as SpotifyTokenResponseDto;

    if (!token.access_token || typeof token.expires_in !== 'number') {
      throw new SpotifyApiError('Spotify auth response is missing an access token.', 'invalid_response', response.status);
    }

    this.token = {
      value: token.access_token,
      expiresAt: Date.now() + Math.max(token.expires_in - 60, 0) * 1000,
    };

    return token.access_token;
  }

  async fetchFreshReleasesFromSpotify(options: FetchFreshReleasesFromSpotifyOptions = {}): Promise<Release[]> {
    const token = await this.getAppAccessToken();
    const limit = clampSearchLimit(options.limit ?? MAX_SEARCH_LIMIT);
    const pages = normalizePages(options.pages ?? 1);
    const albums: SpotifyAlbumDto[] = [];
    const seenAlbumIds = new Set<string>();

    for (let page = 0; page < pages; page += 1) {
      const searchUrl = new URL(`${SPOTIFY_API_URL}/search`);

      searchUrl.searchParams.set('q', 'tag:new');
      searchUrl.searchParams.set('type', 'album');
      searchUrl.searchParams.set('limit', String(limit));
      searchUrl.searchParams.set('offset', String(page * limit));

      if (options.market) {
        searchUrl.searchParams.set('market', options.market);
      }

      const response = await this.request(searchUrl.toString(), {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = (await response.json()) as SpotifySearchAlbumsResponseDto;
      const pageAlbums = data.albums?.items ?? [];

      for (const album of pageAlbums) {
        if (album.id && seenAlbumIds.has(album.id)) {
          continue;
        }

        if (album.id) {
          seenAlbumIds.add(album.id);
        }

        albums.push(album);
      }

      if (pageAlbums.length < limit) {
        break;
      }
    }

    if (albums.length === 0) {
      return [];
    }

    const artistsById = await this.fetchArtistsById(token, albums);

    return albums
      .map((album) => enrichAlbumArtists(album, artistsById))
      .map(mapSpotifyAlbumToRelease)
      .filter((release): release is Release => release !== null);
  }

  private async fetchArtistsById(token: string, albums: SpotifyAlbumDto[]): Promise<Map<string, SpotifyArtistDto>> {
    const artistIds = Array.from(
      new Set(
        albums
          .flatMap((album) => album.artists ?? [])
          .map((artist) => artist.id)
          .filter((id): id is string => Boolean(id)),
      ),
    );

    if (artistIds.length === 0) {
      return new Map();
    }

    const artistsById = new Map<string, SpotifyArtistDto>();

    for (let index = 0; index < artistIds.length; index += MAX_ARTIST_IDS_PER_REQUEST) {
      const ids = artistIds.slice(index, index + MAX_ARTIST_IDS_PER_REQUEST);
      const url = new URL(`${SPOTIFY_API_URL}/artists`);
      url.searchParams.set('ids', ids.join(','));

      const response = await this.request(url.toString(), {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = (await response.json()) as SpotifyArtistsResponseDto;

      for (const artist of data.artists ?? []) {
        if (artist.id) {
          artistsById.set(artist.id, artist);
        }
      }
    }

    return artistsById;
  }

  private async request(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    let response: Response;

    try {
      response = await this.fetchFn(input, init);
    } catch (error) {
      throw new SpotifyApiError(error instanceof Error ? error.message : 'Spotify network request failed.', 'network');
    }

    if (response.ok) {
      return response;
    }

    throw new SpotifyApiError(
      `Spotify API request failed with status ${response.status}.`,
      mapErrorCode(response.status),
      response.status,
      parseRetryAfter(response.headers),
    );
  }
}

function enrichAlbumArtists(album: SpotifyAlbumDto, artistsById: Map<string, SpotifyArtistDto>): SpotifyAlbumDto {
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

function clampSearchLimit(limit: number): number {
  return Math.min(Math.max(Math.trunc(limit), 1), MAX_SEARCH_LIMIT);
}

function normalizePages(pages: number): number {
  return Math.max(Math.trunc(pages), 1);
}

function encodeBasicAuth(clientId: string, clientSecret: string): string {
  return btoa(`${clientId}:${clientSecret}`);
}

function mapErrorCode(status: number): SpotifyApiErrorCode {
  if (status === 401 || status === 403) {
    return 'auth';
  }

  if (status === 429) {
    return 'rate_limited';
  }

  return 'api';
}

function parseRetryAfter(headers: Headers): number | null {
  const value = headers.get('retry-after');

  if (!value) {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? null : parsed;
}
