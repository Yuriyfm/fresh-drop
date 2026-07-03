import type { Release } from '../domain/release';
import type { ReleaseRepository } from '../data/releaseRepository';
import type { SyncTask, SyncTaskInput, SyncTaskRepository } from '../data/syncTaskRepository';
import { SpotifyApiError } from '../spotify/spotifyApiAdapter';
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
  tasksDeferred: number;
  itemsFound: number;
  itemsSaved: number;
  itemsDeleted: number;
  stoppedDueToRateLimit: boolean;
  retryAt?: Date;
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
    tasksDeferred: 0,
    itemsFound: 0,
    itemsSaved: 0,
    itemsDeleted: 0,
    stoppedDueToRateLimit: false,
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
      const existingReleaseIds = await releases.findExistingReleaseIds(recentReleases.map((release) => release.id));
      const newReleases = recentReleases.filter((release) => !existingReleaseIds.has(release.id));
      const saveResult = await releases.saveReleases(newReleases);
      const inserted = await tasks.enqueueTasks(getFollowUpTasks(task, page, newReleases, config));

      await tasks.completeTask({
        id: task.id,
        status: 'success',
        itemsFound: page.releases.length,
        itemsSaved: saveResult.saved,
        nextRunAt: getNextRunAt(task, page, config, currentDate),
      });

      result.tasksSucceeded += 1;
      result.tasksInserted += inserted.inserted;
      result.itemsFound += page.releases.length;
      result.itemsSaved += saveResult.saved;
    } catch (error) {
      const retryDelaySeconds = getRetryDelaySeconds(error);
      const retryNextRunAt = getRetryNextRunAt(error, currentDate);

      await tasks.completeTask({
        id: task.id,
        status: 'failed',
        itemsFound: 0,
        itemsSaved: 0,
        errorMessage: formatCrawlerError(error),
        retryAfterSeconds: retryDelaySeconds,
        nextRunAt: retryNextRunAt,
      });
      result.tasksFailed += 1;

      if (isRateLimitError(error) && retryNextRunAt) {
        const remainingTaskIds = claimed
          .slice(claimed.indexOf(task) + 1)
          .map((claimedTask) => claimedTask.id);

        await tasks.releaseTasks(remainingTaskIds, retryNextRunAt, formatCrawlerError(error));
        result.tasksDeferred += remainingTaskIds.length;
        result.tasksDeferred += await tasks.postponePendingTasks(retryNextRunAt, formatCrawlerError(error));
        result.stoppedDueToRateLimit = true;
        result.retryAt = retryNextRunAt;
        break;
      }
    }
  }

  const cleanup = await releases.cleanupOldReleases(currentDate, config.retentionDays);
  result.itemsDeleted = cleanup.deleted;

  return result;
}

function getNextRunAt(
  task: SyncTask,
  _page: SpotifyReleasePage,
  config: ReleaseCrawlerConfig,
  currentDate: Date,
): Date | undefined {
  if (task.source !== 'search') {
    return undefined;
  }

  return new Date(currentDate.getTime() + config.searchTaskCooldownMinutes * 60 * 1000);
}

function getFollowUpTasks(task: SyncTask, page: SpotifyReleasePage, newReleases: Release[], config: ReleaseCrawlerConfig): SyncTaskInput[] {
  const followUps: SyncTaskInput[] = [];

  if (task.source === 'search' && page.nextOffset !== null && page.nextOffset <= SEARCH_MAX_OFFSET && newReleases.length > 0) {
    followUps.push({
      source: 'search',
      query: task.query,
      market: task.market,
      offset: page.nextOffset,
      limit: task.limit,
      priority: getSearchFollowUpPriority(task.priority, newReleases.length),
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
    for (const artistId of getArtistIds(newReleases)) {
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

function getSearchFollowUpPriority(currentPriority: number, newReleaseCount: number): number {
  return currentPriority - Math.min(newReleaseCount, 25);
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

function getRetryDelaySeconds(error: unknown): number | null {
  if (error instanceof SpotifyApiError) {
    if (error.code === 'rate_limited') {
      return Math.max(error.retryAfterSeconds ?? 60, 1);
    }

    if (error.code === 'network' || (error.status !== null && error.status >= 500)) {
      return 300;
    }

    return null;
  }

  return null;
}

function getRetryNextRunAt(error: unknown, currentDate: Date): Date | undefined {
  const retryDelaySeconds = getRetryDelaySeconds(error);

  if (retryDelaySeconds === null) {
    return undefined;
  }

  return new Date(currentDate.getTime() + retryDelaySeconds * 1000);
}

function isRateLimitError(error: unknown): boolean {
  return error instanceof SpotifyApiError && error.code === 'rate_limited';
}
