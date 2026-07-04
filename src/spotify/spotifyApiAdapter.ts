import type { Release } from '../domain/release';
import { enrichSpotifyAlbumArtists, mapSpotifyAlbumToRelease } from './mapSpotifyAlbum';
import { SpotifyRequestScheduler, type SpotifyRequestSchedulerConfig } from './spotifyRequestScheduler';
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
const MAX_REQUEST_RETRIES = 3;
const MAX_ARTIST_FETCH_RETRIES = 3;

type FetchLike = typeof fetch;

export type SpotifyApiAdapterConfig = {
  clientId: string;
  clientSecret: string;
  requestScheduler?: SpotifyRequestScheduler;
  requestSchedulerConfig?: Omit<SpotifyRequestSchedulerConfig, 'nowFn' | 'sleepFn'>;
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

export type SpotifyReleaseSearchAlbumsPage = {
  albums: SpotifyAlbumDto[];
  total: number | null;
  nextOffset: number | null;
  requestCount: number;
};

export type SpotifyArtistsByIdResult = {
  artistsById: Map<string, SpotifyArtistDto>;
  retryAfterSeconds: number | null;
  requestCount: number;
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
  private readonly nowFn: () => number;
  private readonly sleepFn: (delayMs: number) => Promise<void>;
  private readonly requestScheduler: SpotifyRequestScheduler;
  private token: { value: string; expiresAt: number } | null = null;

  constructor(config: SpotifyApiAdapterConfig) {
    this.clientId = config.clientId;
    this.clientSecret = config.clientSecret;
    this.fetchFn = config.fetchFn ?? fetch;
    this.nowFn = config.nowFn ?? Date.now;
    this.sleepFn = config.sleepFn ?? sleep;
    this.requestScheduler = config.requestScheduler ?? new SpotifyRequestScheduler({
      ...config.requestSchedulerConfig,
      nowFn: this.nowFn,
      sleepFn: this.sleepFn,
    });
  }

  async getAppAccessToken(counter?: RequestCounter): Promise<string> {
    if (this.token && this.token.expiresAt > this.nowFn()) {
      return this.token.value;
    }

    const response = await this.request(
      SPOTIFY_ACCOUNTS_URL,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${encodeBasicAuth(this.clientId, this.clientSecret)}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ grant_type: 'client_credentials' }),
      },
      counter,
    );

    const token = (await response.json()) as SpotifyTokenResponseDto;

    if (!token.access_token || typeof token.expires_in !== 'number') {
      throw new SpotifyApiError('Spotify auth response is missing an access token.', 'invalid_response', response.status);
    }

    this.token = {
      value: token.access_token,
      expiresAt: this.nowFn() + Math.max(token.expires_in - 60, 0) * 1000,
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

    const { artistsById } = await this.fetchArtistsByIdsWithToken(
      token,
      getAlbumArtistIds(albums),
      undefined,
      MAX_ARTIST_FETCH_RETRIES,
    );

    return albums
      .map((album) => enrichSpotifyAlbumArtists(album, artistsById))
      .map(mapSpotifyAlbumToRelease)
      .filter((release): release is Release => release !== null);
  }

  async fetchReleaseSearchAlbumsPage(options: FetchSpotifyReleaseSearchPageOptions): Promise<SpotifyReleaseSearchAlbumsPage> {
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

    return {
      albums,
      total: typeof data.albums?.total === 'number' ? data.albums.total : null,
      nextOffset: data.albums?.next && albums.length > 0 ? offset + limit : null,
      requestCount: requestCounter.count,
    };
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

  async fetchArtistsByIds(artistIds: string[]): Promise<SpotifyArtistsByIdResult> {
    const requestCounter: RequestCounter = { count: 0 };
    const token = await this.getAppAccessToken(requestCounter);

    return this.fetchArtistsByIdsWithToken(token, artistIds, requestCounter);
  }

  getRequestSchedulerState(): ReturnType<SpotifyRequestScheduler['getState']> {
    return this.requestScheduler.getState();
  }

  private async fetchArtistsByIdsWithToken(
    token: string,
    artistIds: string[],
    counter?: RequestCounter,
    maxRetries = MAX_REQUEST_RETRIES,
  ): Promise<SpotifyArtistsByIdResult> {
    const uniqueArtistIds = Array.from(new Set(artistIds.filter((id) => id.trim().length > 0)));

    if (uniqueArtistIds.length === 0) {
      return {
        artistsById: new Map(),
        retryAfterSeconds: null,
        requestCount: counter?.count ?? 0,
      };
    }

    const artistsById = new Map<string, SpotifyArtistDto>();
    let retryAfterSeconds: number | null = null;

    for (let index = 0; index < uniqueArtistIds.length; index += MAX_ARTIST_IDS_PER_REQUEST) {
      const ids = uniqueArtistIds.slice(index, index + MAX_ARTIST_IDS_PER_REQUEST);
      const url = new URL(`${SPOTIFY_API_URL}/artists`);
      url.searchParams.set('ids', ids.join(','));

      try {
        const response = await this.request(url.toString(), {
          headers: { Authorization: `Bearer ${token}` },
        }, counter, maxRetries);
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
      requestCount: counter?.count ?? 0,
    };
  }

  private async mapAlbumsToReleases(
    token: string,
    albums: SpotifyAlbumDto[],
    counter?: RequestCounter,
  ): Promise<{ releases: Release[]; retryAfterSeconds: number | null }> {
    if (albums.length === 0) {
      return {
        releases: [],
        retryAfterSeconds: null,
      };
    }

    const { artistsById, retryAfterSeconds } = await this.fetchArtistsByIdsWithToken(
      token,
      getAlbumArtistIds(albums),
      counter,
      MAX_ARTIST_FETCH_RETRIES,
    );

    return {
      releases: albums
        .map((album) => enrichSpotifyAlbumArtists(album, artistsById))
        .map(mapSpotifyAlbumToRelease)
        .filter((release): release is Release => release !== null),
      retryAfterSeconds,
    };
  }

  private async request(
    input: RequestInfo | URL,
    init?: RequestInit,
    counter?: RequestCounter,
    maxRetries = MAX_REQUEST_RETRIES,
  ): Promise<Response> {
    for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
      if (counter) {
        counter.count += 1;
      }

      await this.requestScheduler.waitForTurn();

      try {
        const response = await this.fetchFn(input, init);

        if (response.ok) {
          this.requestScheduler.recordSuccess();
          return response;
        }

        const retryAfterSeconds = parseRetryAfter(response.headers);

        if (response.status === 429) {
          this.requestScheduler.recordRateLimit(retryAfterSeconds);
          throw new SpotifyApiError(
            `Spotify API request failed with status ${response.status}.`,
            'rate_limited',
            response.status,
            retryAfterSeconds,
          );
        }

        if (response.status >= 500 && attempt < maxRetries) {
          await this.sleepFn(this.requestScheduler.getRetryDelayMs(attempt));
          continue;
        }

        throw new SpotifyApiError(
          `Spotify API request failed with status ${response.status}.`,
          mapErrorCode(response.status),
          response.status,
          retryAfterSeconds,
        );
      } catch (error) {
        if (error instanceof SpotifyApiError) {
          throw error;
        }

        if (attempt < maxRetries) {
          await this.sleepFn(this.requestScheduler.getRetryDelayMs(attempt));
          continue;
        }

        throw new SpotifyApiError(
          error instanceof Error ? error.message : 'Spotify network request failed.',
          'network',
        );
      } finally {
        this.requestScheduler.finishRequest();
      }
    }

    throw new SpotifyApiError('Spotify request retries exhausted.', 'network');
  }
}

function getAlbumArtistIds(albums: SpotifyAlbumDto[]): string[] {
  return albums.flatMap((album) => album.artists ?? [])
    .map((artist) => artist.id)
    .filter((id): id is string => Boolean(id));
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

function getRetryDelaySeconds(error: unknown): number | null {
  if (!(error instanceof SpotifyApiError)) {
    return null;
  }

  if (error.code === 'rate_limited') {
    return Math.max(error.retryAfterSeconds ?? 30, 1);
  }

  if (error.code === 'network' || (error.status !== null && error.status >= 500)) {
    return 300;
  }

  return null;
}

function sleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}
