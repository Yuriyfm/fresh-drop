import type { Release } from '../domain/release';
import type { ReleaseRepository } from '../data/releaseRepository';
import type { SyncTask, SyncTaskInput, SyncTaskRepository } from '../data/syncTaskRepository';
import type { SpotifyReleasePage } from '../spotify/spotifyApiAdapter';
import type { ReleaseCrawlerConfig } from './crawlerConfig';

export type ReleaseCrawlerSource = {
  fetchReleaseSearchPage(options: { query: string; market: string; limit: number; offset: number }): Promise<SpotifyReleasePage>;
  fetchArtistAlbumsPage(options: { artistId: string; market: string; limit: number; offset: number }): Promise<SpotifyReleasePage>;
};

export type ReleaseCrawlerResult = {
  tasksClaimed: number;
  tasksSucceeded: number;
  tasksFailed: number;
  tasksInserted: number;
  itemsFound: number;
  itemsSaved: number;
  itemsDeleted: number;
};

const SEARCH_MAX_OFFSET = 1000;

export async function runReleaseCrawler(
  source: ReleaseCrawlerSource,
  releases: ReleaseRepository,
  tasks: SyncTaskRepository,
  config: ReleaseCrawlerConfig,
  currentDate = new Date(),
): Promise<ReleaseCrawlerResult> {
  const seedResult = await tasks.enqueueTasks(
    config.searchQueries.map((query, index) => ({
      source: 'search',
      query,
      market: config.market,
      offset: 0,
      limit: config.searchLimit,
      priority: index,
      nextRunAt: currentDate,
    })),
  );
  const claimed = await tasks.claimPendingTasks(config.batchSize, currentDate);
  const result: ReleaseCrawlerResult = {
    tasksClaimed: claimed.length,
    tasksSucceeded: 0,
    tasksFailed: 0,
    tasksInserted: seedResult.inserted,
    itemsFound: 0,
    itemsSaved: 0,
    itemsDeleted: 0,
  };

  for (const task of claimed) {
    try {
      const page = task.source === 'search'
        ? await source.fetchReleaseSearchPage({
          query: task.query,
          market: task.market,
          limit: task.limit,
          offset: task.offset,
        })
        : await source.fetchArtistAlbumsPage({
          artistId: task.query,
          market: task.market,
          limit: task.limit,
          offset: task.offset,
        });
      const recentReleases = filterRecentDayPrecisionReleases(page.releases, currentDate, config.retentionDays);
      const saveResult = await releases.saveReleases(recentReleases);
      const inserted = await tasks.enqueueTasks(getFollowUpTasks(task, page, recentReleases, config));

      await tasks.completeTask({
        id: task.id,
        status: 'success',
        itemsFound: page.releases.length,
        itemsSaved: saveResult.saved,
      });

      result.tasksSucceeded += 1;
      result.tasksInserted += inserted.inserted;
      result.itemsFound += page.releases.length;
      result.itemsSaved += saveResult.saved;
    } catch (error) {
      await tasks.completeTask({
        id: task.id,
        status: 'failed',
        itemsFound: 0,
        itemsSaved: 0,
        errorMessage: formatCrawlerError(error),
        retryAfterSeconds: getRetryAfterSeconds(error),
      });
      result.tasksFailed += 1;
    }
  }

  const cleanup = await releases.cleanupOldReleases(currentDate, config.retentionDays);
  result.itemsDeleted = cleanup.deleted;

  return result;
}

function getFollowUpTasks(task: SyncTask, page: SpotifyReleasePage, releases: Release[], config: ReleaseCrawlerConfig): SyncTaskInput[] {
  const followUps: SyncTaskInput[] = [];

  if (task.source === 'search' && page.nextOffset !== null && page.nextOffset <= SEARCH_MAX_OFFSET) {
    followUps.push({
      source: 'search',
      query: task.query,
      market: task.market,
      offset: page.nextOffset,
      limit: task.limit,
      priority: task.priority,
    });
  }

  if (task.source === 'artist_albums' && page.nextOffset !== null) {
    followUps.push({
      source: 'artist_albums',
      query: task.query,
      market: task.market,
      offset: page.nextOffset,
      limit: config.artistAlbumsLimit,
      priority: 50,
    });
  }

  if (config.enableArtistExpansion) {
    for (const artistId of getArtistIds(releases)) {
      followUps.push({
        source: 'artist_albums',
        query: artistId,
        market: task.market,
        offset: 0,
        limit: config.artistAlbumsLimit,
        priority: 50,
      });
    }
  }

  return followUps;
}

function filterRecentDayPrecisionReleases(releases: Release[], currentDate: Date, retentionDays: number): Release[] {
  const cutoff = Date.UTC(currentDate.getUTCFullYear(), currentDate.getUTCMonth(), currentDate.getUTCDate()) -
    retentionDays * 24 * 60 * 60 * 1000;

  return releases.filter((release) => {
    if (release.releaseDatePrecision !== 'day' || !release.releaseDate) {
      return false;
    }

    const timestamp = Date.parse(`${release.releaseDate}T00:00:00.000Z`);

    return !Number.isNaN(timestamp) && timestamp >= cutoff;
  });
}

function getArtistIds(releases: Release[]): string[] {
  return Array.from(
    new Set(
      releases
        .flatMap((release) => release.artists)
        .map((artist) => artist.id)
        .filter(Boolean),
    ),
  );
}

function formatCrawlerError(error: unknown): string {
  return error instanceof Error ? error.message : 'Release crawler task failed.';
}

function getRetryAfterSeconds(error: unknown): number | null {
  return error && typeof error === 'object' && 'retryAfterSeconds' in error && typeof error.retryAfterSeconds === 'number'
    ? error.retryAfterSeconds
    : null;
}
