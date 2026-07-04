import type { Release } from '../domain/release';
import { mapSpotifyAlbumToRelease } from './mapSpotifyAlbum';
import type {
  SpotifyAlbumDto,
  SpotifyAlbumsPageResponseDto,
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
  minRequestIntervalMs?: number;
  fetchFn?: FetchLike;
  nowFn?: () => number;
  sleepFn?: (delayMs: number) => Promise<void>;
};

export type FetchFreshReleasesFromSpotifyOptions = {
  limit?: number;
  market?: string;
  pages?: number;
};

export type FetchSpotifyReleaseSearchPageOptions = {
  query: string;
  limit?: number;
  market?: string;
  offset?: number;
};

export type FetchSpotifyArtistAlbumsPageOptions = {
  artistId: string;
  limit?: number;
  market?: string;
  offset?: number;
};

export type SpotifyReleasePage = {
  releases: Release[];
  total: number | null;
  nextOffset: number | null;
  retryAfterSeconds?: number | null;
  requestCount: number;
};

type RequestCounter = {
  count: number;
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
  private readonly minRequestIntervalMs: number;
  private readonly nowFn: () => number;
  private readonly sleepFn: (delayMs: number) => Promise<void>;
  private token: { value: string; expiresAt: number } | null = null;
  private nextRequestAt = 0;

  constructor(config: SpotifyApiAdapterConfig) {
    this.clientId = config.clientId;
    this.clientSecret = config.clientSecret;
    this.fetchFn = config.fetchFn ?? fetch;
    this.minRequestIntervalMs = normalizeMinRequestIntervalMs(config.minRequestIntervalMs);
    this.nowFn = config.nowFn ?? Date.now;
    this.sleepFn = config.sleepFn ?? sleep;
  }

  async getAppAccessToken(counter?: RequestCounter): Promise<string> {
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
    }, counter);

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

    const { artistsById } = await this.fetchArtistsById(token, albums);

    return albums
      .map((album) => enrichAlbumArtists(album, artistsById))
      .map(mapSpotifyAlbumToRelease)
      .filter((release): release is Release => release !== null);
  }

  async fetchReleaseSearchPage(options: FetchSpotifyReleaseSearchPageOptions): Promise<SpotifyReleasePage> {
    const requestCounter: RequestCounter = { count: 0 };
    const token = await this.getAppAccessToken(requestCounter);
    const limit = clampSearchLimit(options.limit ?? MAX_SEARCH_LIMIT);
    const offset = Math.max(Math.trunc(options.offset ?? 0), 0);
    const searchUrl = new URL(`${SPOTIFY_API_URL}/search`);

    searchUrl.searchParams.set('q', options.query);
    searchUrl.searchParams.set('type', 'album');
    searchUrl.searchParams.set('limit', String(limit));
    searchUrl.searchParams.set('offset', String(offset));

    if (options.market) {
      searchUrl.searchParams.set('market', options.market);
    }

    const response = await this.request(searchUrl.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    }, requestCounter);
    const data = (await response.json()) as SpotifySearchAlbumsResponseDto;
    const albums = data.albums?.items ?? [];

    const mapped = await this.mapAlbumsToReleases(token, albums, requestCounter);

    return {
      releases: mapped.releases,
      total: typeof data.albums?.total === 'number' ? data.albums.total : null,
      nextOffset: data.albums?.next && albums.length > 0 ? offset + limit : null,
      retryAfterSeconds: mapped.retryAfterSeconds,
      requestCount: requestCounter.count,
    };
  }

  async fetchArtistAlbumsPage(options: FetchSpotifyArtistAlbumsPageOptions): Promise<SpotifyReleasePage> {
    const requestCounter: RequestCounter = { count: 0 };
    const token = await this.getAppAccessToken(requestCounter);
    const limit = clampArtistAlbumsLimit(options.limit ?? 10);
    const offset = Math.max(Math.trunc(options.offset ?? 0), 0);
    const url = new URL(`${SPOTIFY_API_URL}/artists/${encodeURIComponent(options.artistId)}/albums`);

    url.searchParams.set('include_groups', 'album,single,compilation');
    url.searchParams.set('limit', String(limit));
    url.searchParams.set('offset', String(offset));

    if (options.market) {
      url.searchParams.set('market', options.market);
    }

    const response = await this.request(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    }, requestCounter);
    const data = (await response.json()) as SpotifyAlbumsPageResponseDto;
    const albums = data.items ?? [];

    const mapped = await this.mapAlbumsToReleases(token, albums, requestCounter);

    return {
      releases: mapped.releases,
      total: typeof data.total === 'number' ? data.total : null,
      nextOffset: data.next && albums.length > 0 ? offset + limit : null,
      retryAfterSeconds: mapped.retryAfterSeconds,
      requestCount: requestCounter.count,
    };
  }

  private async fetchArtistsById(token: string, albums: SpotifyAlbumDto[], counter?: RequestCounter): Promise<{
    artistsById: Map<string, SpotifyArtistDto>;
    retryAfterSeconds: number | null;
  }> {
    const artistIds = Array.from(
      new Set(
        albums
          .flatMap((album) => album.artists ?? [])
          .map((artist) => artist.id)
          .filter((id): id is string => Boolean(id)),
      ),
    );

    if (artistIds.length === 0) {
      return {
        artistsById: new Map(),
        retryAfterSeconds: null,
      };
    }

    const artistsById = new Map<string, SpotifyArtistDto>();
    let retryAfterSeconds: number | null = null;

    for (let index = 0; index < artistIds.length; index += MAX_ARTIST_IDS_PER_REQUEST) {
      const ids = artistIds.slice(index, index + MAX_ARTIST_IDS_PER_REQUEST);
      const url = new URL(`${SPOTIFY_API_URL}/artists`);
      url.searchParams.set('ids', ids.join(','));

      try {
        const response = await this.request(url.toString(), {
          headers: { Authorization: `Bearer ${token}` },
        }, counter);
        const data = (await response.json()) as SpotifyArtistsResponseDto;

        for (const artist of data.artists ?? []) {
          if (artist.id) {
            artistsById.set(artist.id, artist);
          }
        }
      } catch (error) {
        const delaySeconds = getRetryDelaySeconds(error);

        if (delaySeconds === null) {
          throw error;
        }

        retryAfterSeconds = retryAfterSeconds ?? delaySeconds;
        break;
      }
    }

    return {
      artistsById,
      retryAfterSeconds,
    };
  }

  private async mapAlbumsToReleases(token: string, albums: SpotifyAlbumDto[], counter?: RequestCounter): Promise<{
    releases: Release[];
    retryAfterSeconds: number | null;
  }> {
    if (albums.length === 0) {
      return {
        releases: [],
        retryAfterSeconds: null,
      };
    }

    const { artistsById, retryAfterSeconds } = await this.fetchArtistsById(token, albums, counter);

    return {
      releases: albums
        .map((album) => enrichAlbumArtists(album, artistsById))
        .map(mapSpotifyAlbumToRelease)
        .filter((release): release is Release => release !== null),
      retryAfterSeconds,
    };
  }

  private async request(input: RequestInfo | URL, init?: RequestInit, counter?: RequestCounter): Promise<Response> {
    if (counter) {
      counter.count += 1;
    }

    await this.waitForRequestWindow();

    let response: Response;

    try {
      response = await this.fetchFn(input, init);
    } catch (error) {
      this.deferNextRequest(this.minRequestIntervalMs);
      throw new SpotifyApiError(error instanceof Error ? error.message : 'Spotify network request failed.', 'network');
    }

    if (response.ok) {
      this.deferNextRequest(this.minRequestIntervalMs);
      return response;
    }

    this.deferNextRequest(getRetryDelayMs(response) ?? this.minRequestIntervalMs);

    throw new SpotifyApiError(
      `Spotify API request failed with status ${response.status}.`,
      mapErrorCode(response.status),
      response.status,
      parseRetryAfter(response.headers),
    );
  }

  private async waitForRequestWindow(): Promise<void> {
    const delayMs = this.nextRequestAt - this.nowFn();

    if (delayMs > 0) {
      await this.sleepFn(delayMs);
    }
  }

  private deferNextRequest(delayMs: number): void {
    this.nextRequestAt = Math.max(this.nextRequestAt, this.nowFn()) + Math.max(delayMs, 0);
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

function clampArtistAlbumsLimit(limit: number): number {
  return Math.min(Math.max(Math.trunc(limit), 1), 10);
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

function getRetryDelayMs(response: Response): number | null {
  const retryAfterSeconds = parseRetryAfter(response.headers);

  if (retryAfterSeconds === null) {
    return response.status === 429 ? 60_000 : null;
  }

  return Math.max(retryAfterSeconds, 1) * 1000;
}

function getRetryDelaySeconds(error: unknown): number | null {
  if (!(error instanceof SpotifyApiError)) {
    return null;
  }

  if (error.code === 'rate_limited') {
    return Math.max(error.retryAfterSeconds ?? 60, 1);
  }

  if (error.code === 'network' || (error.status !== null && error.status >= 500)) {
    return 300;
  }

  return null;
}

function normalizeMinRequestIntervalMs(value: number | undefined): number {
  if (value === undefined) {
    return 0;
  }

  if (!Number.isFinite(value) || value < 0) {
    throw new Error('Spotify API min request interval must be a non-negative number.');
  }

  return Math.trunc(value);
}

function sleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}
