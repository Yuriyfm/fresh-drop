import process from 'node:process';
import { Pool } from 'pg';
import { PostgresReleaseRepository } from '../src/data/postgresReleaseRepository';
import { PostgresSyncTaskRepository } from '../src/data/syncTaskRepository';
import { SpotifyApiAdapter } from '../src/spotify/spotifyApiAdapter';
import { getReleaseCrawlerConfigFromEnv } from '../src/sync/crawlerConfig';
import { runReleaseCrawler } from '../src/sync/releaseCrawlerService';
import { getReleaseSyncConfigFromEnv } from '../src/sync/syncConfig';

async function main(): Promise<void> {
  const syncConfig = getReleaseSyncConfigFromEnv(process.env);
  const crawlerConfig = getReleaseCrawlerConfigFromEnv(process.env);
  const pool = new Pool(getDatabasePoolConfig());

  try {
    const spotify = new SpotifyApiAdapter(syncConfig.spotify);
    const releases = new PostgresReleaseRepository({ pool });
    const tasks = new PostgresSyncTaskRepository({ pool });

    console.info(
      `Starting release crawler: market=${crawlerConfig.market}` +
        ` batch=${crawlerConfig.batchSize}` +
        ` queries=${crawlerConfig.searchSeeds.length}`,
    );

    const result = await runReleaseCrawler(spotify, releases, tasks, crawlerConfig);

    console.info(
      `Release crawler success:` +
        ` tasksClaimed=${result.tasksClaimed}` +
        ` tasksSucceeded=${result.tasksSucceeded}` +
        ` tasksFailed=${result.tasksFailed}` +
        ` tasksInserted=${result.tasksInserted}` +
        ` tasksDeferred=${result.tasksDeferred}` +
        ` requests=${result.requestsMade}` +
        ` found=${result.itemsFound}` +
        ` saved=${result.itemsSaved}` +
        ` deleted=${result.itemsDeleted}` +
        ` rateLimited=${result.stoppedDueToRateLimit}` +
        ` retryAt=${result.retryAt?.toISOString() ?? 'n/a'}`,
    );

    for (const task of result.taskSummaries) {
      console.info(
        `Crawler task:` +
          ` query="${task.query}"` +
          ` source=${task.source}` +
          ` family=${task.family ?? 'n/a'}` +
          ` token=${task.token ?? 'n/a'}` +
          ` depth=${task.depth}` +
          ` status=${task.status}` +
          ` requests=${task.requestCount}` +
          ` spotifyTotal=${task.spotifyTotal ?? 'n/a'}` +
          ` pages=${task.pagesFetched}` +
          ` seen=${task.itemsSeen}` +
          ` found=${task.itemsFound}` +
          ` saved=${task.itemsSaved}` +
          ` duplicates=${task.duplicatesSeen}` +
          ` duplicateRate=${task.duplicateRate.toFixed(4)}` +
          ` emptyPages=${task.emptyPages}` +
          ` avgLatencyMs=${task.avgLatencyMs ?? 'n/a'}` +
          ` priority=${task.priority}` +
          ` split=${task.wasSplit}` +
          ` childTasksInserted=${task.childTasksInserted}` +
          ` retryAfterSeconds=${task.retryAfterSeconds ?? 'n/a'}` +
          ` retryAt=${task.retryAt?.toISOString() ?? 'n/a'}` +
          ` error=${JSON.stringify(task.errorMessage ?? null)}`,
      );

      if (task.wasSplit) {
        console.info(
          `Crawler split:` +
            ` query="${task.query}"` +
            ` depth=${task.depth}` +
            ` spotifyTotal=${task.spotifyTotal ?? 'n/a'}` +
            ` childTasksInserted=${task.childTasksInserted}`,
        );
      }

      if (task.status === 'exhausted') {
        console.info(
          `Crawler exhausted:` +
            ` query="${task.query}"` +
            ` seen=${task.itemsSeen}` +
            ` uniqueAdded=${task.uniqueAdded}` +
            ` duplicateRate=${task.duplicateRate.toFixed(4)}`,
        );
      }

      if (task.status === 'rate_limited') {
        console.info(
          `Crawler rate limit:` +
            ` query="${task.query}"` +
            ` retryAfterSeconds=${task.retryAfterSeconds ?? 'n/a'}` +
            ` retryAt=${task.retryAt?.toISOString() ?? 'n/a'}`,
        );
      }
    }

    if (result.tasksFailed > 0 && !result.stoppedDueToRateLimit) {
      process.exitCode = 1;
    }
  } finally {
    await pool.end();
  }
}

function getDatabasePoolConfig(): { connectionString: string } | undefined {
  return process.env.DATABASE_URL ? { connectionString: process.env.DATABASE_URL } : undefined;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Release crawler failed.');
  process.exitCode = 1;
});
