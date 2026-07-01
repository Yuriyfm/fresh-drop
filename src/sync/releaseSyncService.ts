import type { Release } from '../domain/release';
import type { ReleaseRepository } from '../data/releaseRepository';
import type { SyncRunRepository } from '../data/syncRunRepository';
import type { FetchFreshReleasesFromSpotifyOptions } from '../spotify/spotifyApiAdapter';

export type FreshReleaseSource = {
  fetchFreshReleasesFromSpotify(options?: FetchFreshReleasesFromSpotifyOptions): Promise<Release[]>;
};

export type ReleaseSyncRunOptions = FetchFreshReleasesFromSpotifyOptions;

export type ReleaseSyncResult = {
  status: 'success' | 'failed';
  itemsFound: number;
  itemsSaved: number;
  itemsDeleted: number;
  smoke: ReleaseSyncSmokeStats;
  errorMessage: string | null;
};

export type ReleaseSyncService = {
  syncFreshReleases(options?: ReleaseSyncRunOptions): Promise<ReleaseSyncResult>;
};

export type ReleaseSyncSmokeStats = {
  releases: number;
  artists: number;
  releasesUnknownCountry: number;
  artistsUnknownCountry: number;
  releasesNullPopularity: number;
  artistsNullPopularity: number;
};

const RELEASE_RETENTION_DAYS = 30;

export function createReleaseSyncService(
  source: FreshReleaseSource,
  repository: ReleaseRepository,
  syncRuns: SyncRunRepository,
): ReleaseSyncService {
  return {
    async syncFreshReleases(options: ReleaseSyncRunOptions = {}): Promise<ReleaseSyncResult> {
      const syncRun = await syncRuns.startSyncRun({ source: 'spotify' });
      let itemsFound = 0;
      let itemsSaved = 0;
      let smoke = createEmptySmokeStats();

      try {
        const releases = await source.fetchFreshReleasesFromSpotify(options);
        itemsFound = releases.length;
        smoke = getReleaseSyncSmokeStats(releases);
        const saveResult = await repository.saveReleases(releases);
        itemsSaved = saveResult.saved;
        const cleanupResult = await repository.cleanupOldReleases(new Date(), RELEASE_RETENTION_DAYS);

        await syncRuns.finishSyncRun({
          id: syncRun.id,
          status: 'success',
          itemsFound,
          itemsSaved,
        });

        return {
          status: 'success',
          itemsFound,
          itemsSaved,
          itemsDeleted: cleanupResult.deleted,
          smoke,
          errorMessage: null,
        };
      } catch (error) {
        const errorMessage = formatSyncError(error);

        await syncRuns.finishSyncRun({
          id: syncRun.id,
          status: 'failed',
          itemsFound,
          itemsSaved,
          errorMessage,
        });

        return {
          status: 'failed',
          itemsFound,
          itemsSaved,
          itemsDeleted: 0,
          smoke,
          errorMessage,
        };
      }
    },
  };
}

function getReleaseSyncSmokeStats(releases: Release[]): ReleaseSyncSmokeStats {
  const artistsById = new Map<string, Release['artists'][number]>();

  for (const release of releases) {
    for (const artist of release.artists) {
      artistsById.set(artist.id || artist.name, artist);
    }
  }

  const artists = Array.from(artistsById.values());

  return {
    releases: releases.length,
    artists: artists.length,
    releasesUnknownCountry: releases.filter((release) => release.country === 'unknown').length,
    artistsUnknownCountry: artists.filter((artist) => artist.country === 'unknown').length,
    releasesNullPopularity: releases.filter((release) => release.popularity === null).length,
    artistsNullPopularity: artists.filter((artist) => artist.popularity === null).length,
  };
}

function createEmptySmokeStats(): ReleaseSyncSmokeStats {
  return {
    releases: 0,
    artists: 0,
    releasesUnknownCountry: 0,
    artistsUnknownCountry: 0,
    releasesNullPopularity: 0,
    artistsNullPopularity: 0,
  };
}

function formatSyncError(error: unknown): string {
  if (!(error instanceof Error)) {
    return 'Release sync failed.';
  }

  const retryAfter = 'retryAfterSeconds' in error && typeof error.retryAfterSeconds === 'number'
    ? ` Retry after ${error.retryAfterSeconds} seconds.`
    : '';

  return `${error.message}${retryAfter}`;
}
