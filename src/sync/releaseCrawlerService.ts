import type { Release } from '../domain/release';
import type { ReleaseRepository } from '../data/releaseRepository';
import type { CompleteSyncTaskInput, SyncTask, SyncTaskInput, SyncTaskRepository } from '../data/syncTaskRepository';
import { SpotifyApiError } from '../spotify/spotifyApiAdapter';
import type { SpotifyReleasePage } from '../spotify/spotifyApiAdapter';
import type { ReleaseCrawlerConfig } from './crawlerConfig';
import { buildSearchShardQuery, createChildSearchShardSeeds, getSearchShardPriority } from './searchShard';

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
};

export async function runReleaseCrawler(
  source: ReleaseCrawlerSource,
  releases: ReleaseRepository,
  tasks: SyncTaskRepository,
  config: ReleaseCrawlerConfig,
  currentDate = new Date(),
): Promise<ReleaseCrawlerResult> {
  await tasks.deactivateLegacySearchTasks(currentDate);

  const seedResult = await tasks.enqueueTasks(
    config.searchSeeds.map((seed) => ({
      source: 'search',
      query: buildSearchShardQuery(seed.family, seed.token),
      market: config.market,
      offset: 0,
      limit: config.searchLimit,
      priority: seed.priority,
      nextRunAt: currentDate,
      family: seed.family,
      token: seed.token,
      depth: seed.depth,
    })),
  );
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
        result.tasksDeferred += await tasks.postponePendingTasks(taskResult.completeInput.nextRunAt ?? currentDate, taskResult.completeInput.errorMessage);
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
        result.tasksDeferred += await tasks.postponePendingTasks(failure.retryNextRunAt, failure.completeInput.errorMessage);
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

  try {
    while (offset <= config.maxSafeOffset) {
      const startedAt = Date.now();
      const page = await source.fetchReleaseSearchPage({
        query: task.query,
        market: task.market,
        limit: task.limit,
        offset,
      });

      latencyTotalMs += Date.now() - startedAt;
      pagesFetched += 1;
      lastOffset = offset;
      spotifyTotal = page.total ?? spotifyTotal;
    itemsFound += page.releases.length;
    itemsSeen += page.releases.length;
    requestCount = page.requestCount ?? 0;

      if (page.releases.length === 0) {
        emptyPages += 1;
        break;
      }

      const recentReleases = filterRecentDayPrecisionReleases(page.releases, currentDate, config.retentionDays);
      const existingReleaseIds = await releases.findExistingReleaseIds(recentReleases.map((release) => release.id));
      const newReleases = recentReleases.filter((release) => !existingReleaseIds.has(release.id));
      const saveResult = await releases.saveReleases(newReleases);

      uniqueAdded += saveResult.saved;
      duplicatesSeen += recentReleases.length - newReleases.length;

      if (page.retryAfterSeconds !== null && page.retryAfterSeconds !== undefined) {
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
          retryAfterSeconds: page.retryAfterSeconds,
        });
      }

      if (
        offset >= config.maxSafeOffset ||
        page.releases.length < task.limit ||
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
        retryAfterSeconds,
      });
    }

    throw error;
  }

  const duplicateRate = duplicatesSeen / Math.max(itemsSeen, 1);
  const priority = getSearchShardPriority(task.depth, uniqueAdded, duplicateRate, spotifyTotal);
  const cooldownAt = getCompletedNextRunAt(config, currentDate, duplicateRate >= 0.95 && itemsSeen >= 300);
  const saturated = spotifyTotal !== null && spotifyTotal >= config.maxSafeOffset;
  const canSplit = saturated && task.family !== null && task.depth < config.maxShardDepth;
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
    const newReleases = recentReleases.filter((release) => !existingReleaseIds.has(release.id));
    const saveResult = await releases.saveReleases(newReleases);
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
      return Math.max(error.retryAfterSeconds ?? 60, 1);
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
  };
}
