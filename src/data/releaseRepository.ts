import type { ArtistSummary, PopularityFilter, Release, ReleaseFilters, ReleaseTypeFilter } from '../domain/release';
import { filterReleases, sortReleasesForSearch } from '../domain/releaseFilters';

export type ReleaseQuery = Omit<ReleaseFilters, 'currentDate'> & {
  page?: number;
  limit?: number;
  currentDate?: Date;
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

export type ReleaseRepository = {
  saveReleases(releases: Release[]): Promise<{ saved: number }>;
  findExistingReleaseIds(ids: string[]): Promise<Set<string>>;
  findReleases(query: ReleaseQuery): Promise<ReleasePage>;
  cleanupOldReleases(currentDate: Date, retentionDays: number): Promise<{ deleted: number }>;
};

export const DEFAULT_RELEASE_PAGE = 1;
export const DEFAULT_RELEASE_LIMIT = 20;
export const MAX_RELEASE_LIMIT = 50;

export class InMemoryReleaseRepository implements ReleaseRepository {
  private readonly releasesBySpotifyId = new Map<string, Release>();

  async saveReleases(releases: Release[]): Promise<{ saved: number }> {
    for (const release of releases) {
      this.releasesBySpotifyId.set(release.id, cloneRelease(release));
    }

    return { saved: releases.length };
  }

  async findExistingReleaseIds(ids: string[]): Promise<Set<string>> {
    return new Set(ids.filter((id) => this.releasesBySpotifyId.has(id)));
  }

  async findReleases(query: ReleaseQuery): Promise<ReleasePage> {
    const page = normalizeReleasePage(query.page);
    const limit = normalizeReleaseLimit(query.limit);
    const currentDate = query.currentDate ?? new Date();
    const filtered = sortReleasesForSearch(filterReleases(Array.from(this.releasesBySpotifyId.values()), {
      period: query.period,
      genre: query.genre,
      country: query.country,
      type: query.type ?? 'all',
      popularity: query.popularity ?? 'all',
      currentDate,
    }));
    const offset = (page - 1) * limit;
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

export type ReleaseRepositoryFilters = {
  type: ReleaseTypeFilter;
  popularity: PopularityFilter;
};
