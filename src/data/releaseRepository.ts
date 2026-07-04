import type { ArtistSummary, Release, ReleaseFilters, ReleaseTypeFilter } from '../domain/release';
import { filterReleases, sortReleasesForSearch } from '../domain/releaseFilters';
import {
  matchesGenreValue,
  NO_GENRE_FILTER,
  normalizeGenreText,
  TOP_LEVEL_GENRES,
  type GenreOptionKind,
} from '../domain/topLevelGenres';

export type ReleaseQuery = Omit<ReleaseFilters, 'currentDate'> & {
  page?: number;
  limit?: number;
  currentDate?: Date;
  randomStartSeed?: string;
};

export type ReleasePage = {
  items: Release[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    hasNextPage: boolean;
  };
};

export type GenreCount = {
  genre: string;
  releaseCount: number;
  kind: GenreOptionKind;
};

export type SaveReleasesOptions = {
  discoveredMarket?: string;
  discoveredAt?: Date;
};

export type ReleaseRepository = {
  saveReleases(releases: Release[], options?: SaveReleasesOptions): Promise<{ saved: number }>;
  findExistingReleaseIds(ids: string[]): Promise<Set<string>>;
  findCachedArtists(ids: string[], options: { maxAgeDays: number; now?: Date }): Promise<Map<string, ArtistSummary>>;
  saveReleaseMarkets(ids: string[], market: string, seenAt?: Date): Promise<void>;
  findReleases(query: ReleaseQuery): Promise<ReleasePage>;
  listActiveGenres(): Promise<GenreCount[]>;
  cleanupOldReleases(currentDate: Date, retentionDays: number): Promise<{ deleted: number }>;
};

export const DEFAULT_RELEASE_PAGE = 1;
export const DEFAULT_RELEASE_LIMIT = 20;
export const MAX_RELEASE_LIMIT = 50;

type CachedArtistRecord = {
  artist: ArtistSummary;
  updatedAt: Date;
};

export class InMemoryReleaseRepository implements ReleaseRepository {
  private readonly releasesBySpotifyId = new Map<string, Release>();
  private readonly artistsBySpotifyId = new Map<string, CachedArtistRecord>();
  private readonly marketsByReleaseId = new Map<string, Map<string, { firstSeenAt: Date; lastSeenAt: Date }>>();

  async saveReleases(releases: Release[], options: SaveReleasesOptions = {}): Promise<{ saved: number }> {
    const discoveredAt = options.discoveredAt ?? new Date();

    for (const release of releases) {
      this.releasesBySpotifyId.set(release.id, cloneRelease(release));

      for (const artist of release.artists) {
        this.artistsBySpotifyId.set(artist.id, {
          artist: cloneArtist(artist),
          updatedAt: discoveredAt,
        });
      }

      if (options.discoveredMarket) {
        upsertReleaseMarket(this.marketsByReleaseId, release.id, options.discoveredMarket, discoveredAt);
      }
    }

    return { saved: releases.length };
  }

  async findExistingReleaseIds(ids: string[]): Promise<Set<string>> {
    return new Set(ids.filter((id) => this.releasesBySpotifyId.has(id)));
  }

  async findCachedArtists(ids: string[], options: { maxAgeDays: number; now?: Date }): Promise<Map<string, ArtistSummary>> {
    const cutoff = (options.now ?? new Date()).getTime() - options.maxAgeDays * 24 * 60 * 60 * 1000;
    const cachedArtists = new Map<string, ArtistSummary>();

    for (const id of Array.from(new Set(ids))) {
      const cached = this.artistsBySpotifyId.get(id);

      if (!cached || cached.updatedAt.getTime() < cutoff) {
        continue;
      }

      cachedArtists.set(id, cloneArtist(cached.artist));
    }

    return cachedArtists;
  }

  async saveReleaseMarkets(ids: string[], market: string, seenAt = new Date()): Promise<void> {
    for (const id of Array.from(new Set(ids))) {
      if (!this.releasesBySpotifyId.has(id)) {
        continue;
      }

      upsertReleaseMarket(this.marketsByReleaseId, id, market, seenAt);
    }
  }

  async findReleases(query: ReleaseQuery): Promise<ReleasePage> {
    const page = normalizeReleasePage(query.page);
    const limit = normalizeReleaseLimit(query.limit);
    const currentDate = query.currentDate ?? new Date();
    const filtered = sortReleasesForSearch(filterReleases(Array.from(this.releasesBySpotifyId.values()), {
      period: query.period,
      genre: query.genre,
      genres: query.genres,
      country: query.country,
      type: query.type ?? 'all',
      sort: query.sort ?? 'newest',
      currentDate,
    }), query.sort ?? 'newest');
    const offset = getReleaseOffset({
      page,
      limit,
      total: filtered.length,
      randomStartSeed: query.randomStartSeed,
    });
    const items = filtered.slice(offset, offset + limit).map(cloneRelease);

    return {
      items,
      pagination: {
        page,
        limit,
        total: filtered.length,
        hasNextPage: offset + items.length < filtered.length,
      },
    };
  }

  async listActiveGenres(): Promise<GenreCount[]> {
    const releases = Array.from(this.releasesBySpotifyId.values());
    const exactCounts = new Map<string, number>();

    for (const release of releases) {
      for (const genre of normalizeGenres(release.genres)) {
        exactCounts.set(genre, (exactCounts.get(genre) ?? 0) + 1);
      }
    }

    const generalGenres = TOP_LEVEL_GENRES.map((genre) => ({
      genre,
      kind: 'general' as const,
      releaseCount: releases.filter((release) => release.genres.some((releaseGenre) => matchesGenreValue(releaseGenre, genre))).length,
    })).filter((option) => option.releaseCount > 0);
    const exactGenres = Array.from(exactCounts.entries())
      .filter(([, releaseCount]) => releaseCount > 0)
      .map(([genre, releaseCount]) => ({ genre, releaseCount, kind: 'exact' as const }))
      .filter((option) => !generalGenres.some((general) => general.genre === option.genre))
      .sort((left, right) => left.genre.localeCompare(right.genre));
    const missingGenreCount = releases.filter((release) => normalizeGenres(release.genres).length === 0).length;
    const missingGenre = missingGenreCount > 0
      ? [{ genre: NO_GENRE_FILTER, releaseCount: missingGenreCount, kind: 'missing' as const }]
      : [];

    return [...generalGenres, ...missingGenre, ...exactGenres];
  }

  async cleanupOldReleases(currentDate: Date, retentionDays: number): Promise<{ deleted: number }> {
    const cutoff = startOfUtcDay(currentDate).getTime() - retentionDays * 24 * 60 * 60 * 1000;
    let deleted = 0;

    for (const [spotifyId, release] of this.releasesBySpotifyId) {
      if (release.releaseDatePrecision !== 'day') {
        continue;
      }

      const releaseDate = new Date(`${release.releaseDate}T00:00:00.000Z`);

      if (!Number.isNaN(releaseDate.getTime()) && releaseDate.getTime() < cutoff) {
        this.releasesBySpotifyId.delete(spotifyId);
        this.marketsByReleaseId.delete(spotifyId);
        deleted += 1;
      }
    }

    return { deleted };
  }
}

export function normalizeReleasePage(page?: number): number {
  return Number.isFinite(page) ? Math.max(Math.trunc(page ?? DEFAULT_RELEASE_PAGE), 1) : DEFAULT_RELEASE_PAGE;
}

export function normalizeReleaseLimit(limit?: number): number {
  return Number.isFinite(limit)
    ? Math.min(Math.max(Math.trunc(limit ?? DEFAULT_RELEASE_LIMIT), 1), MAX_RELEASE_LIMIT)
    : DEFAULT_RELEASE_LIMIT;
}

export function getReleaseOffset(options: {
  page: number;
  limit: number;
  total: number;
  randomStartSeed?: string;
}): number {
  const baseOffset = (options.page - 1) * options.limit;

  if (!options.randomStartSeed || options.total <= options.limit) {
    return baseOffset;
  }

  const maxStartOffset = Math.max(options.total - options.limit, 0);
  const randomStartOffset = hashString(options.randomStartSeed) % (maxStartOffset + 1);

  return randomStartOffset + baseOffset;
}

function hashString(value: string): number {
  let hash = 0;

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }

  return hash;
}

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function cloneRelease(release: Release): Release {
  const artists = release.artists.map(cloneArtist);

  return {
    ...release,
    artists,
    primaryArtist: release.primaryArtist ? cloneArtist(release.primaryArtist) : null,
    genres: [...release.genres],
  };
}

function cloneArtist(artist: ArtistSummary): ArtistSummary {
  return {
    ...artist,
    genres: [...artist.genres],
  };
}

function normalizeGenres(genres: string[]): string[] {
  return Array.from(new Set(genres.map(normalizeGenreText).filter(Boolean)));
}

function upsertReleaseMarket(
  marketsByReleaseId: Map<string, Map<string, { firstSeenAt: Date; lastSeenAt: Date }>>,
  releaseId: string,
  market: string,
  seenAt: Date,
): void {
  const markets = marketsByReleaseId.get(releaseId) ?? new Map<string, { firstSeenAt: Date; lastSeenAt: Date }>();
  const existing = markets.get(market);

  markets.set(market, existing
    ? { firstSeenAt: existing.firstSeenAt, lastSeenAt: seenAt }
    : { firstSeenAt: seenAt, lastSeenAt: seenAt });
  marketsByReleaseId.set(releaseId, markets);
}

export type ReleaseRepositoryFilters = {
  type: ReleaseTypeFilter;
};
