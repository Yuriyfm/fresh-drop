import type { ArtistSummary, Release } from '../domain/release';
import type { ReleaseRepository } from '../data/releaseRepository';
import type { CompleteSyncTaskInput, SyncTask, SyncTaskInput, SyncTaskRepository } from '../data/syncTaskRepository';
import { enrichSpotifyAlbumArtists, mapSpotifyAlbumToRelease } from '../spotify/mapSpotifyAlbum';
import { SpotifyApiError } from '../spotify/spotifyApiAdapter';
import type {
  SpotifyArtistsByIdResult,
  SpotifyReleasePage,
  SpotifyReleaseSearchAlbumsPage,
} from '../spotify/spotifyApiAdapter';
import type { SpotifyAlbumDto, SpotifyArtistDto } from '../spotify/spotifyTypes';
import type { ReleaseCrawlerConfig } from './crawlerConfig';
import { buildSearchShardQuery, canSplitSearchShard, createChildSearchShardSeeds, getSearchShardPriority } from './searchShard';

export type ReleaseCrawlerSource = {
  fetchReleaseSearchAlbumsPage(options: { query: string; market: string; limit: number; offset: number }): Promise<SpotifyReleaseSearchAlbumsPage>;
  fetchArtistsByIds(artistIds: string[]): Promise<SpotifyArtistsByIdResult>;
  fetchArtistAlbumsPage(options: { artistId: string; market: string; limit: number; offset: number }): Promise<SpotifyReleasePage>;
};

export type ReleaseCrawlerResult = {
  tasksClaimed: number;
  tasksSucceeded: number;
  tasksFailed: number;
  tasksInserted: number;
  tasksDeferred: number;
  requestsMade: number;
  itemsFound: number;
  itemsSaved: number;
  itemsDeleted: number;
  stoppedDueToRateLimit: boolean;
  retryAt?: Date;
  taskSummaries: ReleaseCrawlerTaskSummary[];
};

export type ReleaseCrawlerTaskSummary = {
  query: string;
  market: string;
  source: SyncTask['source'];
  family: SyncTask['family'];
  token: SyncTask['token'];
  depth: number;
  status: CompleteSyncTaskInput['status'];
  itemsFound: number;
  itemsSaved: number;
  itemsSeen: number;
  uniqueAdded: number;
  duplicatesSeen: number;
  duplicateRate: number;
  spotifyTotal: number | null;
  pagesFetched: number;
  emptyPages: number;
  avgLatencyMs: number | null;
  requestCount: number;
  priority: number;
  wasSplit: boolean;
  childTasksInserted: number;
  retryAfterSeconds: number | null;
  retryAt?: Date;
  errorMessage?: string | null;
  artistCacheHits: number;
  artistRequestsSaved: number;
};

type SearchTaskRunStats = {
  itemsFound: number;
  itemsSaved: number;
  spotifyTotal: number | null;
  pagesFetched: number;
  itemsSeen: number;
  uniqueAdded: number;
  duplicatesSeen: number;
  emptyPages: number;
  lastOffset: number | null;
  avgLatencyMs: number | null;
  rateLimitedCount: number;
  requestCount: number;
  artistCacheHits: number;
  artistRequestsSaved: number;
};

export async function runReleaseCrawler(
  source: ReleaseCrawlerSource,
  releases: ReleaseRepository,
  tasks: SyncTaskRepository,
  config: ReleaseCrawlerConfig,
  currentDate = new Date(),
): Promise<ReleaseCrawlerResult> {
  await tasks.deactivateLegacySearchTasks(currentDate);

  const activeRetryAt = await tasks.getActiveRateLimitRetryAt(currentDate);
  if (activeRetryAt) {
    const cleanup = await releases.cleanupOldReleases(currentDate, config.retentionDays);
    const tasksDeferred = await tasks.postponeRunnableTasks(activeRetryAt);

    return {
      tasksClaimed: 0,
      tasksSucceeded: 0,
      tasksFailed: 0,
      tasksInserted: 0,
      tasksDeferred,
      requestsMade: 0,
      itemsFound: 0,
      itemsSaved: 0,
      itemsDeleted: cleanup.deleted,
      stoppedDueToRateLimit: true,
      retryAt: activeRetryAt,
      taskSummaries: [],
    };
  }

  const seedTasks = config.markets.flatMap((market) => config.searchSeeds
    .filter((seed) => seed.markets === undefined || seed.markets.includes(market))
    .map<SyncTaskInput>((seed) => ({
      source: 'search',
      query: buildSearchShardQuery(seed.family, seed.token),
      market,
      offset: 0,
      limit: config.searchLimit,
      priority: seed.priority,
      nextRunAt: currentDate,
      family: seed.family,
      token: seed.token,
      depth: seed.depth,
    })));
  const seedResult = await tasks.enqueueTasks(seedTasks);
  const claimed = await tasks.claimPendingTasks(config.batchSize, currentDate);
  const result: ReleaseCrawlerResult = {
    tasksClaimed: claimed.length,
    tasksSucceeded: 0,
    tasksFailed: 0,
    tasksInserted: seedResult.inserted,
    tasksDeferred: 0,
    requestsMade: 0,
    itemsFound: 0,
    itemsSaved: 0,
    itemsDeleted: 0,
    stoppedDueToRateLimit: false,
    taskSummaries: [],
  };

  for (const task of claimed) {
    try {
      const taskResult = task.source === 'search'
        ? await runSearchTask(source, releases, tasks, task, config, currentDate)
        : await runArtistAlbumsTask(source, releases, task, config, currentDate);

      await tasks.completeTask(taskResult.completeInput);
      result.taskSummaries.push(buildTaskSummary(task, taskResult.completeInput, taskResult.insertedTasks));
      result.tasksInserted += taskResult.insertedTasks;
      result.itemsFound += taskResult.stats.itemsFound;
      result.itemsSaved += taskResult.stats.itemsSaved;
      result.requestsMade += taskResult.stats.requestCount;

      if (taskResult.completeInput.status === 'rate_limited') {
        const remainingTaskIds = claimed
          .slice(claimed.indexOf(task) + 1)
          .map((claimedTask) => claimedTask.id);

        await tasks.releaseTasks(remainingTaskIds, taskResult.completeInput.nextRunAt ?? currentDate, taskResult.completeInput.errorMessage);
        result.tasksFailed += 1;
        result.tasksDeferred += remainingTaskIds.length;
        result.tasksDeferred += await tasks.postponeRunnableTasks(taskResult.completeInput.nextRunAt ?? currentDate, taskResult.completeInput.errorMessage);
        result.stoppedDueToRateLimit = true;
        result.retryAt = taskResult.completeInput.nextRunAt;
        break;
      }

      result.tasksSucceeded += 1;
    } catch (error) {
      const failure = await buildFailedTaskInput(task, error, currentDate);

      await tasks.completeTask(failure.completeInput);
      result.taskSummaries.push(buildTaskSummary(task, failure.completeInput, 0));
      result.tasksFailed += 1;
      result.itemsFound += failure.stats.itemsFound;
      result.itemsSaved += failure.stats.itemsSaved;

      if (isRateLimitError(error) && failure.retryNextRunAt) {
        const remainingTaskIds = claimed
          .slice(claimed.indexOf(task) + 1)
          .map((claimedTask) => claimedTask.id);

        await tasks.releaseTasks(remainingTaskIds, failure.retryNextRunAt, failure.completeInput.errorMessage);
        result.tasksDeferred += remainingTaskIds.length;
        result.tasksDeferred += await tasks.postponeRunnableTasks(failure.retryNextRunAt, failure.completeInput.errorMessage);
        result.stoppedDueToRateLimit = true;
        result.retryAt = failure.retryNextRunAt;
        break;
      }
    }
  }

  const cleanup = await releases.cleanupOldReleases(currentDate, config.retentionDays);
  result.itemsDeleted = cleanup.deleted;

  return result;
}

async function runSearchTask(
  source: ReleaseCrawlerSource,
  releases: ReleaseRepository,
  tasks: SyncTaskRepository,
  task: SyncTask,
  config: ReleaseCrawlerConfig,
  currentDate: Date,
): Promise<{ completeInput: CompleteSyncTaskInput; insertedTasks: number; stats: SearchTaskRunStats }> {
  let offset = 0;
  let pagesFetched = 0;
  let itemsFound = 0;
  let itemsSeen = 0;
  let uniqueAdded = 0;
  let duplicatesSeen = 0;
  let emptyPages = 0;
  let lastOffset: number | null = null;
  let spotifyTotal: number | null = null;
  let latencyTotalMs = 0;
  let requestCount = 0;
  let artistCacheHits = 0;
  let artistRequestsSaved = 0;

  try {
    while (offset <= config.maxSafeOffset) {
      const startedAt = Date.now();
      const page = await source.fetchReleaseSearchAlbumsPage({
        query: task.query,
        market: task.market,
        limit: task.limit,
        offset,
      });

      latencyTotalMs += Date.now() - startedAt;
      pagesFetched += 1;
      lastOffset = offset;
      spotifyTotal = page.total ?? spotifyTotal;
      requestCount += page.requestCount ?? 0;

      if (page.albums.length === 0) {
        emptyPages += 1;
        break;
      }

      const recentAlbums = filterRecentDayPrecisionAlbums(page.albums, currentDate, config.retentionDays);
      const recentAlbumIds = recentAlbums
        .map((album) => album.id)
        .filter((id): id is string => Boolean(id));

      itemsFound += recentAlbums.length;
      itemsSeen += recentAlbums.length;

      const existingReleaseIds = await releases.findExistingReleaseIds(recentAlbumIds);
      const existingIds = recentAlbumIds.filter((id) => existingReleaseIds.has(id));

      if (existingIds.length > 0) {
        await releases.saveReleaseMarkets(existingIds, task.market, currentDate);
      }

      const newAlbums = recentAlbums.filter((album) => !album.id || !existingReleaseIds.has(album.id));

      duplicatesSeen += recentAlbums.length - newAlbums.length;

      if (newAlbums.length > 0) {
        const artistIds = getAlbumArtistIds(newAlbums);
        const cachedArtists = await releases.findCachedArtists(artistIds, {
          maxAgeDays: config.artistCacheTtlDays,
          now: currentDate,
        });
        const missingArtistIds = artistIds.filter((artistId) => !cachedArtists.has(artistId));

        artistCacheHits += cachedArtists.size;
        artistRequestsSaved += cachedArtists.size;

        let fetchedArtists = new Map<string, SpotifyArtistDto>();

        if (missingArtistIds.length > 0) {
          const artistResult = await source.fetchArtistsByIds(missingArtistIds);
          requestCount += artistResult.requestCount ?? 0;

          if (artistResult.retryAfterSeconds !== null && artistResult.retryAfterSeconds !== undefined) {
            return buildRateLimitedSearchTaskResult({
              task,
              currentDate,
              itemsFound,
              itemsSeen,
              uniqueAdded,
              duplicatesSeen,
              emptyPages,
              lastOffset,
              pagesFetched,
              spotifyTotal,
              latencyTotalMs,
              requestCount,
              artistCacheHits,
              artistRequestsSaved,
              retryAfterSeconds: artistResult.retryAfterSeconds,
            });
          }

          fetchedArtists = artistResult.artistsById;
        }

        const artistsById = mergeArtistsById(cachedArtists, fetchedArtists);
        const newReleases = newAlbums
          .map((album) => enrichSpotifyAlbumArtists(album, artistsById))
          .map(mapSpotifyAlbumToRelease)
          .filter((release): release is Release => release !== null);
        const saveResult = await releases.saveReleases(newReleases, {
          discoveredMarket: task.market,
          discoveredAt: currentDate,
        });

        uniqueAdded += saveResult.saved;
      }

      if (
        offset >= config.maxSafeOffset ||
        page.albums.length < task.limit ||
        page.nextOffset === null ||
        (spotifyTotal !== null && offset + task.limit >= spotifyTotal)
      ) {
        break;
      }

      offset = page.nextOffset;
    }
  } catch (error) {
    const retryAfterSeconds = getRetryDelaySeconds(error);

    if (retryAfterSeconds !== null) {
      return buildRateLimitedSearchTaskResult({
        task,
        currentDate,
        itemsFound,
        itemsSeen,
        uniqueAdded,
        duplicatesSeen,
        emptyPages,
        lastOffset,
        pagesFetched,
        spotifyTotal,
        latencyTotalMs,
        requestCount,
        artistCacheHits,
        artistRequestsSaved,
        retryAfterSeconds,
      });
    }

    throw error;
  }

  const duplicateRate = duplicatesSeen / Math.max(itemsSeen, 1);
  const priority = getSearchShardPriority(task.depth, uniqueAdded, duplicateRate, spotifyTotal);
  const cooldownAt = getCompletedNextRunAt(config, currentDate, duplicateRate >= 0.95 && itemsSeen >= 300);
  const saturated = spotifyTotal !== null && spotifyTotal >= config.splitTotalThreshold;
  const canSplit = saturated
    && task.family !== null
    && task.depth < config.maxShardDepth
    && canSplitSearchShard(task.family, task.token ?? '');
  let insertedTasks = 0;
  let wasSplit = false;

  if (canSplit && task.family !== null) {
    const childSeeds = createChildSearchShardSeeds(task.family, task.token ?? '', task.depth + 1);
    const childTasks: SyncTaskInput[] = childSeeds.map((seed) => ({
      source: 'search',
      query: buildSearchShardQuery(seed.family, seed.token),
      market: task.market,
      limit: task.limit,
      priority: seed.priority,
      nextRunAt: currentDate,
      family: seed.family,
      token: seed.token,
      depth: seed.depth,
      parentTaskId: task.id,
    }));

    const insertResult = await tasks.enqueueTasks(childTasks);
    insertedTasks = insertResult.inserted;
    wasSplit = true;
  }

  const status = canSplit
    ? 'completed'
    : isExhaustedShard(itemsSeen, uniqueAdded, duplicatesSeen)
      ? 'exhausted'
      : 'completed';
  const stats = {
    itemsFound,
    itemsSaved: uniqueAdded,
    spotifyTotal,
    pagesFetched,
    itemsSeen,
    uniqueAdded,
    duplicatesSeen,
    emptyPages,
    lastOffset,
    avgLatencyMs: pagesFetched === 0 ? null : Math.round(latencyTotalMs / pagesFetched),
    rateLimitedCount: 0,
    requestCount,
    artistCacheHits,
    artistRequestsSaved,
  };

  return {
    completeInput: buildCompleteSearchTaskInput({
      task,
      currentDate,
      status,
      itemsFound,
      itemsSaved: uniqueAdded,
      nextRunAt: cooldownAt,
      spotifyTotal,
      pagesFetched,
      itemsSeen,
      uniqueAdded,
      duplicatesSeen,
      emptyPages,
      lastOffset,
      avgLatencyMs: stats.avgLatencyMs,
      rateLimitedCount: 0,
      requestCount: stats.requestCount,
      artistCacheHits,
      artistRequestsSaved,
      priority,
      wasSplit,
    }),
    insertedTasks,
    stats,
  };
}

async function runArtistAlbumsTask(
  source: ReleaseCrawlerSource,
  releases: ReleaseRepository,
  task: SyncTask,
  config: ReleaseCrawlerConfig,
  currentDate: Date,
): Promise<{ completeInput: CompleteSyncTaskInput; insertedTasks: number; stats: SearchTaskRunStats }> {
  const startedAt = Date.now();
  let requestCount = 0;

  try {
    const page = await source.fetchArtistAlbumsPage({
      artistId: task.query,
      market: task.market,
      limit: config.artistAlbumsLimit,
      offset: task.offset,
    });
    const recentReleases = filterRecentDayPrecisionReleases(page.releases, currentDate, config.retentionDays);
    const existingReleaseIds = await releases.findExistingReleaseIds(recentReleases.map((release) => release.id));
    const existingIds = recentReleases.map((release) => release.id).filter((id) => existingReleaseIds.has(id));

    if (existingIds.length > 0) {
      await releases.saveReleaseMarkets(existingIds, task.market, currentDate);
    }

    const newReleases = recentReleases.filter((release) => !existingReleaseIds.has(release.id));
    const saveResult = await releases.saveReleases(newReleases, {
      discoveredMarket: task.market,
      discoveredAt: currentDate,
    });
    requestCount = page.requestCount ?? 0;
    const stats = {
      itemsFound: page.releases.length,
      itemsSaved: saveResult.saved,
      spotifyTotal: page.total,
      pagesFetched: 1,
      itemsSeen: page.releases.length,
      uniqueAdded: saveResult.saved,
      duplicatesSeen: recentReleases.length - newReleases.length,
      emptyPages: page.releases.length === 0 ? 1 : 0,
      lastOffset: task.offset,
      avgLatencyMs: Date.now() - startedAt,
      rateLimitedCount: page.retryAfterSeconds !== null && page.retryAfterSeconds !== undefined ? 1 : 0,
      requestCount,
      artistCacheHits: 0,
      artistRequestsSaved: 0,
    };

    if (page.retryAfterSeconds !== null && page.retryAfterSeconds !== undefined) {
      return {
        completeInput: buildCompleteSearchTaskInput({
          task,
          currentDate,
          status: 'rate_limited',
          itemsFound: stats.itemsFound,
          itemsSaved: stats.itemsSaved,
          nextRunAt: new Date(currentDate.getTime() + page.retryAfterSeconds * 1000),
          spotifyTotal: stats.spotifyTotal,
          pagesFetched: stats.pagesFetched,
          itemsSeen: stats.itemsSeen,
          uniqueAdded: stats.uniqueAdded,
          duplicatesSeen: stats.duplicatesSeen,
          emptyPages: stats.emptyPages,
          lastOffset: stats.lastOffset,
          avgLatencyMs: stats.avgLatencyMs,
          rateLimitedCount: stats.rateLimitedCount,
          requestCount,
          artistCacheHits: 0,
          artistRequestsSaved: 0,
          priority: task.priority,
          wasSplit: false,
          retryAfterSeconds: page.retryAfterSeconds,
        }),
        insertedTasks: 0,
        stats,
      };
    }

    return {
      completeInput: buildCompleteSearchTaskInput({
        task,
        currentDate,
        status: 'completed',
        itemsFound: stats.itemsFound,
        itemsSaved: stats.itemsSaved,
        nextRunAt: undefined,
        spotifyTotal: stats.spotifyTotal,
        pagesFetched: stats.pagesFetched,
        itemsSeen: stats.itemsSeen,
        uniqueAdded: stats.uniqueAdded,
        duplicatesSeen: stats.duplicatesSeen,
        emptyPages: stats.emptyPages,
        lastOffset: stats.lastOffset,
        avgLatencyMs: stats.avgLatencyMs,
        rateLimitedCount: 0,
        requestCount,
        artistCacheHits: 0,
        artistRequestsSaved: 0,
        priority: task.priority,
        wasSplit: false,
      }),
      insertedTasks: 0,
      stats,
    };
  } catch (error) {
    const retryAfterSeconds = getRetryDelaySeconds(error);

    if (retryAfterSeconds !== null) {
      const stats = {
        itemsFound: 0,
        itemsSaved: 0,
        spotifyTotal: task.spotifyTotal,
        pagesFetched: task.pagesFetched,
        itemsSeen: task.itemsSeen,
        uniqueAdded: task.uniqueAdded,
        duplicatesSeen: task.duplicatesSeen,
        emptyPages: task.emptyPages,
        lastOffset: task.lastOffset,
        avgLatencyMs: task.avgLatencyMs,
        rateLimitedCount: isRateLimitError(error) ? task.rateLimitedCount + 1 : task.rateLimitedCount,
        requestCount: 0,
        artistCacheHits: 0,
        artistRequestsSaved: 0,
      };

      return {
        completeInput: buildCompleteSearchTaskInput({
          task,
          currentDate,
          status: 'rate_limited',
          itemsFound: stats.itemsFound,
          itemsSaved: stats.itemsSaved,
          nextRunAt: new Date(currentDate.getTime() + retryAfterSeconds * 1000),
          spotifyTotal: stats.spotifyTotal,
          pagesFetched: stats.pagesFetched,
          itemsSeen: stats.itemsSeen,
          uniqueAdded: stats.uniqueAdded,
          duplicatesSeen: stats.duplicatesSeen,
          emptyPages: stats.emptyPages,
          lastOffset: stats.lastOffset,
          avgLatencyMs: stats.avgLatencyMs,
          rateLimitedCount: stats.rateLimitedCount,
          requestCount: 0,
          artistCacheHits: 0,
          artistRequestsSaved: 0,
          priority: task.priority,
          wasSplit: false,
          retryAfterSeconds,
        }),
        insertedTasks: 0,
        stats,
      };
    }

    throw error;
  }
}

async function buildFailedTaskInput(
  task: SyncTask,
  error: unknown,
  currentDate: Date,
): Promise<{ completeInput: CompleteSyncTaskInput; stats: SearchTaskRunStats; retryNextRunAt?: Date }> {
  const retryDelaySeconds = getRetryDelaySeconds(error);
  const retryNextRunAt = getRetryNextRunAt(error, currentDate);
  const isRetryable = retryNextRunAt !== undefined;
  const stats = {
    itemsFound: 0,
    itemsSaved: 0,
    spotifyTotal: task.spotifyTotal,
    pagesFetched: task.pagesFetched,
    itemsSeen: task.itemsSeen,
    uniqueAdded: task.uniqueAdded,
    duplicatesSeen: task.duplicatesSeen,
    emptyPages: task.emptyPages,
    lastOffset: task.lastOffset,
    avgLatencyMs: task.avgLatencyMs,
    rateLimitedCount: isRateLimitError(error) ? task.rateLimitedCount + 1 : task.rateLimitedCount,
    requestCount: 0,
    artistCacheHits: 0,
    artistRequestsSaved: 0,
  };

  return {
    completeInput: {
      id: task.id,
      status: isRateLimitError(error) ? 'rate_limited' : 'failed',
      itemsFound: 0,
      itemsSaved: 0,
      errorMessage: formatCrawlerError(error),
      retryAfterSeconds: retryDelaySeconds,
      nextRunAt: retryNextRunAt,
      spotifyTotal: stats.spotifyTotal,
      pagesFetched: stats.pagesFetched,
      itemsSeen: stats.itemsSeen,
      uniqueAdded: stats.uniqueAdded,
      duplicatesSeen: stats.duplicatesSeen,
      emptyPages: stats.emptyPages,
      lastOffset: stats.lastOffset,
      avgLatencyMs: stats.avgLatencyMs,
      rateLimitedCount: stats.rateLimitedCount,
      completedAt: currentDate,
      priority: task.priority,
      wasSplit: task.wasSplit,
      artistCacheHits: 0,
      artistRequestsSaved: 0,
    },
    stats,
    retryNextRunAt,
  };
}

function getCompletedNextRunAt(config: ReleaseCrawlerConfig, currentDate: Date, isExhausted: boolean): Date {
  const cooldownMinutes = isExhausted
    ? Math.max(config.searchTaskCooldownMinutes * 4, config.searchTaskCooldownMinutes)
    : config.searchTaskCooldownMinutes;

  return new Date(currentDate.getTime() + cooldownMinutes * 60 * 1000);
}

function isExhaustedShard(itemsSeen: number, uniqueAdded: number, duplicatesSeen: number): boolean {
  if (itemsSeen < 300) {
    return false;
  }

  const uniqueYield = uniqueAdded / Math.max(itemsSeen, 1);
  const duplicateRate = duplicatesSeen / Math.max(itemsSeen, 1);

  return uniqueYield < 0.01 || duplicateRate > 0.95;
}

function filterRecentDayPrecisionAlbums(albums: SpotifyAlbumDto[], currentDate: Date, retentionDays: number): SpotifyAlbumDto[] {
  const cutoff = Date.UTC(currentDate.getUTCFullYear(), currentDate.getUTCMonth(), currentDate.getUTCDate()) -
    retentionDays * 24 * 60 * 60 * 1000;

  return albums.filter((album) => {
    if (album.release_date_precision !== 'day' || !album.release_date) {
      return false;
    }

    const timestamp = Date.parse(`${album.release_date}T00:00:00.000Z`);

    return !Number.isNaN(timestamp) && timestamp >= cutoff;
  });
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

function formatCrawlerError(error: unknown): string {
  return error instanceof Error ? error.message : 'Release crawler task failed.';
}

function getRetryDelaySeconds(error: unknown): number | null {
  if (error instanceof SpotifyApiError) {
    if (error.code === 'rate_limited') {
      return Math.max(error.retryAfterSeconds ?? 30, 1);
    }

    if (error.code === 'network' || (error.status !== null && error.status >= 500)) {
      return 300;
    }

    return null;
  }

  return null;
}

function buildCompleteSearchTaskInput(input: {
  task: SyncTask;
  currentDate: Date;
  status: CompleteSyncTaskInput['status'];
  itemsFound: number;
  itemsSaved: number;
  nextRunAt?: Date;
  spotifyTotal: number | null;
  pagesFetched: number;
  itemsSeen: number;
  uniqueAdded: number;
  duplicatesSeen: number;
  emptyPages: number;
  lastOffset: number | null;
  avgLatencyMs: number | null;
  rateLimitedCount: number;
  priority: number;
  wasSplit: boolean;
  retryAfterSeconds?: number | null;
  requestCount?: number;
  artistCacheHits: number;
  artistRequestsSaved: number;
}): CompleteSyncTaskInput {
  return {
    id: input.task.id,
    status: input.status,
    itemsFound: input.itemsFound,
    itemsSaved: input.itemsSaved,
    nextRunAt: input.nextRunAt,
    spotifyTotal: input.spotifyTotal,
    pagesFetched: input.pagesFetched,
    itemsSeen: input.itemsSeen,
    uniqueAdded: input.uniqueAdded,
    duplicatesSeen: input.duplicatesSeen,
    emptyPages: input.emptyPages,
    lastOffset: input.lastOffset,
    avgLatencyMs: input.avgLatencyMs,
    rateLimitedCount: input.rateLimitedCount,
    completedAt: input.currentDate,
    priority: input.priority,
    wasSplit: input.wasSplit,
    retryAfterSeconds: input.retryAfterSeconds ?? null,
    requestCount: input.requestCount ?? 0,
    artistCacheHits: input.artistCacheHits,
    artistRequestsSaved: input.artistRequestsSaved,
  };
}

function buildRateLimitedSearchTaskResult(input: {
  task: SyncTask;
  currentDate: Date;
  itemsFound: number;
  itemsSeen: number;
  uniqueAdded: number;
  duplicatesSeen: number;
  emptyPages: number;
  lastOffset: number | null;
  pagesFetched: number;
  spotifyTotal: number | null;
  latencyTotalMs: number;
  requestCount: number;
  artistCacheHits: number;
  artistRequestsSaved: number;
  retryAfterSeconds: number;
}): { completeInput: CompleteSyncTaskInput; insertedTasks: number; stats: SearchTaskRunStats } {
  const stats = {
    itemsFound: input.itemsFound,
    itemsSaved: input.uniqueAdded,
    spotifyTotal: input.spotifyTotal,
    pagesFetched: input.pagesFetched,
    itemsSeen: input.itemsSeen,
    uniqueAdded: input.uniqueAdded,
    duplicatesSeen: input.duplicatesSeen,
    emptyPages: input.emptyPages,
    lastOffset: input.lastOffset,
    avgLatencyMs: input.pagesFetched === 0 ? null : Math.round(input.latencyTotalMs / input.pagesFetched),
    rateLimitedCount: 1,
    requestCount: input.requestCount,
    artistCacheHits: input.artistCacheHits,
    artistRequestsSaved: input.artistRequestsSaved,
  };

  return {
    completeInput: buildCompleteSearchTaskInput({
      task: input.task,
      currentDate: input.currentDate,
      status: 'rate_limited',
      itemsFound: stats.itemsFound,
      itemsSaved: stats.itemsSaved,
      nextRunAt: new Date(input.currentDate.getTime() + input.retryAfterSeconds * 1000),
      spotifyTotal: stats.spotifyTotal,
      pagesFetched: stats.pagesFetched,
      itemsSeen: stats.itemsSeen,
      uniqueAdded: stats.uniqueAdded,
      duplicatesSeen: stats.duplicatesSeen,
      emptyPages: stats.emptyPages,
      lastOffset: stats.lastOffset,
      avgLatencyMs: stats.avgLatencyMs,
      rateLimitedCount: stats.rateLimitedCount,
      requestCount: stats.requestCount,
      artistCacheHits: input.artistCacheHits,
      artistRequestsSaved: input.artistRequestsSaved,
      priority: input.task.priority,
      wasSplit: false,
      retryAfterSeconds: input.retryAfterSeconds,
    }),
    insertedTasks: 0,
    stats,
  };
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

function buildTaskSummary(
  task: SyncTask,
  completeInput: CompleteSyncTaskInput,
  childTasksInserted: number,
): ReleaseCrawlerTaskSummary {
  const itemsSeen = completeInput.itemsSeen ?? task.itemsSeen;
  const duplicatesSeen = completeInput.duplicatesSeen ?? task.duplicatesSeen;

  return {
    query: task.query,
    market: task.market,
    source: task.source,
    family: task.family,
    token: task.token,
    depth: task.depth,
    status: completeInput.status,
    itemsFound: completeInput.itemsFound,
    itemsSaved: completeInput.itemsSaved,
    itemsSeen,
    uniqueAdded: completeInput.uniqueAdded ?? task.uniqueAdded,
    duplicatesSeen,
    duplicateRate: duplicatesSeen / Math.max(itemsSeen, 1),
    spotifyTotal: completeInput.spotifyTotal ?? task.spotifyTotal,
    pagesFetched: completeInput.pagesFetched ?? task.pagesFetched,
    emptyPages: completeInput.emptyPages ?? task.emptyPages,
    avgLatencyMs: completeInput.avgLatencyMs ?? task.avgLatencyMs,
    priority: completeInput.priority ?? task.priority,
    wasSplit: completeInput.wasSplit ?? task.wasSplit,
    childTasksInserted,
    retryAfterSeconds: completeInput.retryAfterSeconds ?? null,
    retryAt: completeInput.nextRunAt,
    errorMessage: completeInput.errorMessage ?? null,
    requestCount: completeInput.requestCount ?? 0,
    artistCacheHits: completeInput.artistCacheHits ?? 0,
    artistRequestsSaved: completeInput.artistRequestsSaved ?? 0,
  };
}

function getAlbumArtistIds(albums: SpotifyAlbumDto[]): string[] {
  return Array.from(new Set(
    albums.flatMap((album) => album.artists ?? [])
      .map((artist) => artist.id)
      .filter((id): id is string => Boolean(id)),
  ));
}

function mergeArtistsById(
  cachedArtists: Map<string, ArtistSummary>,
  fetchedArtists: Map<string, SpotifyArtistDto>,
): Map<string, SpotifyArtistDto> {
  const artistsById = new Map<string, SpotifyArtistDto>();

  for (const [artistId, artist] of cachedArtists) {
    artistsById.set(artistId, {
      id: artist.id,
      name: artist.name,
      genres: [...artist.genres],
      popularity: artist.popularity ?? undefined,
    });
  }

  for (const [artistId, artist] of fetchedArtists) {
    artistsById.set(artistId, artist);
  }

  return artistsById;
}
