import { MusicBrainzRateLimiter } from './musicbrainzRateLimiter';
import { normalizeMusicBrainzGenres, type MusicBrainzGenre } from './musicbrainzGenres';
import { getCountryNameFromCode, normalizeCountryName } from '../../domain/countryNames';

type FetchLike = typeof fetch;

export type MusicBrainzClientConfig = {
  baseUrl: string;
  userAgent: string;
  rateLimitMs: number;
  timeoutMs?: number;
  rateLimiter?: MusicBrainzRateLimiter;
  fetchFn?: FetchLike;
};

export type MusicBrainzUrlLookupResult = {
  spotifyArtistUrl: string;
  status: 'matched' | 'not_found' | 'ambiguous';
  musicBrainzArtistMbid?: string;
  musicBrainzArtistName?: string;
};

export type MusicBrainzArtistGenresResult = {
  musicBrainzArtistMbid: string;
  musicBrainzArtistName?: string;
  musicBrainzArtistCountry?: string;
  genres: MusicBrainzGenre[];
};

type MusicBrainzLookupRelation = {
  'target-type'?: unknown;
  artist?: {
    id?: unknown;
    name?: unknown;
  };
};

export class MusicBrainzApiError extends Error {
  readonly status: number | null;
  readonly retryable: boolean;

  constructor(message: string, status: number | null, retryable: boolean) {
    super(message);
    this.name = 'MusicBrainzApiError';
    this.status = status;
    this.retryable = retryable;
  }
}

export class MusicBrainzClient {
  private readonly baseUrl: string;
  private readonly userAgent: string;
  private readonly timeoutMs: number;
  private readonly rateLimiter: MusicBrainzRateLimiter;
  private readonly fetchFn: FetchLike;
  private requestCount = 0;

  constructor(config: MusicBrainzClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
    this.userAgent = config.userAgent;
    this.timeoutMs = config.timeoutMs ?? 15_000;
    this.rateLimiter = config.rateLimiter ?? new MusicBrainzRateLimiter({ minIntervalMs: config.rateLimitMs });
    this.fetchFn = config.fetchFn ?? fetch;
  }

  async lookupSpotifyArtistUrls(urls: string[]): Promise<MusicBrainzUrlLookupResult[]> {
    if (urls.length === 0) {
      return [];
    }

    const response = await this.requestJson('/url', (searchParams) => {
      for (const url of urls) {
        searchParams.append('resource', url);
      }

      searchParams.set('inc', 'artist-rels');
      searchParams.set('fmt', 'json');
    });

    return parseMusicBrainzUrlLookupResults(urls, response);
  }

  async lookupArtistGenres(musicBrainzArtistMbid: string): Promise<MusicBrainzArtistGenresResult> {
    const response = await this.requestJson(`/artist/${encodeURIComponent(musicBrainzArtistMbid)}`, (searchParams) => {
      searchParams.set('inc', 'genres');
      searchParams.set('fmt', 'json');
    });

    if (!response || typeof response !== 'object') {
      throw new MusicBrainzApiError('MusicBrainz artist lookup returned an invalid payload.', null, true);
    }

    return {
      musicBrainzArtistMbid,
      musicBrainzArtistName: typeof response.name === 'string' ? response.name : undefined,
      musicBrainzArtistCountry: parseMusicBrainzArtistCountry(response),
      genres: normalizeMusicBrainzGenres(response.genres),
    };
  }

  getRequestCount(): number {
    return this.requestCount;
  }

  private async requestJson(
    path: string,
    buildSearchParams: (searchParams: URLSearchParams) => void,
  ): Promise<Record<string, unknown>> {
    return this.rateLimiter.schedule(async () => {
      this.requestCount += 1;

      const url = new URL(`${this.baseUrl}${path}`);
      buildSearchParams(url.searchParams);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

      try {
        const response = await this.fetchFn(url, {
          headers: {
            'User-Agent': this.userAgent,
            Accept: 'application/json',
          },
          signal: controller.signal,
        });

        if (!response.ok) {
          throw createMusicBrainzApiError(response.status);
        }

        try {
          const json = await response.json();

          if (!json || typeof json !== 'object') {
            throw new MusicBrainzApiError('MusicBrainz returned an invalid JSON document.', null, true);
          }

          return json as Record<string, unknown>;
        } catch (error) {
          if (error instanceof MusicBrainzApiError) {
            throw error;
          }

          throw new MusicBrainzApiError('MusicBrainz returned invalid JSON.', null, true);
        }
      } catch (error) {
        if (error instanceof MusicBrainzApiError) {
          throw error;
        }

        if (error instanceof Error && error.name === 'AbortError') {
          throw new MusicBrainzApiError('MusicBrainz request timed out.', null, true);
        }

        throw new MusicBrainzApiError(
          error instanceof Error ? error.message : 'MusicBrainz request failed.',
          null,
          true,
        );
      } finally {
        clearTimeout(timeout);
      }
    });
  }
}

export function parseMusicBrainzUrlLookupResults(
  requestedUrls: string[],
  payload: Record<string, unknown>,
): MusicBrainzUrlLookupResult[] {
  const requested = Array.from(new Set(requestedUrls));
  const entities = getUrlEntities(payload);
  const entitiesByResource = new Map<string, Record<string, unknown>>();

  for (const entity of entities) {
    const resource = typeof entity.resource === 'string' ? entity.resource : '';

    if (resource) {
      entitiesByResource.set(resource, entity);
    }
  }

  return requested.map((spotifyArtistUrl) => {
    const entity = entitiesByResource.get(spotifyArtistUrl);

    if (!entity) {
      return { spotifyArtistUrl, status: 'not_found' as const };
    }

    return parseMusicBrainzUrlLookupEntity(spotifyArtistUrl, entity);
  });
}

function parseMusicBrainzUrlLookupEntity(
  spotifyArtistUrl: string,
  entity: Record<string, unknown>,
): MusicBrainzUrlLookupResult {
  const relations = Array.isArray(entity.relations) ? entity.relations as MusicBrainzLookupRelation[] : [];

  if (relations.length === 0) {
    return { spotifyArtistUrl, status: 'not_found' };
  }

  const artistRelations = relations.filter((relation) => relation?.['target-type'] === 'artist');

  if (artistRelations.length === 0) {
    return { spotifyArtistUrl, status: 'ambiguous' };
  }

  const artists = artistRelations
    .map((relation) => relation.artist)
    .filter((artist): artist is NonNullable<MusicBrainzLookupRelation['artist']> => Boolean(artist));
  const uniqueArtistIds = Array.from(
    new Set(
      artists
        .map((artist) => typeof artist.id === 'string' ? artist.id.trim() : '')
        .filter(Boolean),
    ),
  );

  if (artists.length !== artistRelations.length || uniqueArtistIds.length !== 1) {
    return { spotifyArtistUrl, status: 'ambiguous' };
  }

  const firstArtist = artists[0];

  return {
    spotifyArtistUrl,
    status: 'matched',
    musicBrainzArtistMbid: uniqueArtistIds[0],
    musicBrainzArtistName: typeof firstArtist.name === 'string' ? firstArtist.name : undefined,
  };
}

function getUrlEntities(payload: Record<string, unknown>): Array<Record<string, unknown>> {
  if (Array.isArray(payload.urls)) {
    return payload.urls.filter((entity): entity is Record<string, unknown> => Boolean(entity) && typeof entity === 'object');
  }

  if (typeof payload.resource === 'string') {
    return [payload];
  }

  throw new MusicBrainzApiError('MusicBrainz URL lookup returned an invalid payload.', null, true);
}

function createMusicBrainzApiError(status: number): MusicBrainzApiError {
  if (status === 404) {
    return new MusicBrainzApiError('MusicBrainz entity was not found.', status, false);
  }

  if (status === 429 || status === 503 || status >= 500) {
    return new MusicBrainzApiError(`MusicBrainz request failed with status ${status}.`, status, true);
  }

  return new MusicBrainzApiError(`MusicBrainz request failed with status ${status}.`, status, false);
}

function parseMusicBrainzArtistCountry(payload: Record<string, unknown>): string | undefined {
  const countryCode = typeof payload.country === 'string' ? payload.country.trim().toUpperCase() : '';

  if (countryCode) {
    return getCountryNameFromCode(countryCode);
  }

  const area = payload.area;

  if (area && typeof area === 'object') {
    const areaRecord = area as Record<string, unknown>;
    const areaName = typeof areaRecord.name === 'string' ? areaRecord.name.trim() : '';

    if (areaName) {
      return normalizeCountryName(areaName);
    }
  }

  return undefined;
}
