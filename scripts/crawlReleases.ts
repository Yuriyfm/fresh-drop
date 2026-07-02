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
        ` queries=${crawlerConfig.searchQueries.length}`,
    );

    const result = await runReleaseCrawler(spotify, releases, tasks, crawlerConfig);

    console.info(
      `Release crawler success:` +
        ` tasksClaimed=${result.tasksClaimed}` +
        ` tasksSucceeded=${result.tasksSucceeded}` +
        ` tasksFailed=${result.tasksFailed}` +
        ` tasksInserted=${result.tasksInserted}` +
        ` found=${result.itemsFound}` +
        ` saved=${result.itemsSaved}` +
        ` deleted=${result.itemsDeleted}`,
    );

    if (result.tasksFailed > 0) {
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
