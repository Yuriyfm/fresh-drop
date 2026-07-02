import process from 'node:process';
import { Pool } from 'pg';
import { PostgresReleaseRepository } from '../src/data/postgresReleaseRepository';
import { getReleaseCrawlerConfigFromEnv } from '../src/sync/crawlerConfig';

async function main(): Promise<void> {
  const config = getReleaseCrawlerConfigFromEnv(process.env);
  const pool = new Pool(getDatabasePoolConfig());

  try {
    const releases = new PostgresReleaseRepository({ pool });
    const result = await releases.cleanupOldReleases(new Date(), config.retentionDays);

    console.info(`Release cleanup success: deleted=${result.deleted} retentionDays=${config.retentionDays}`);
  } finally {
    await pool.end();
  }
}

function getDatabasePoolConfig(): { connectionString: string } | undefined {
  return process.env.DATABASE_URL ? { connectionString: process.env.DATABASE_URL } : undefined;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Release cleanup failed.');
  process.exitCode = 1;
});
