import process from 'node:process';
import { Pool } from 'pg';
import { PostgresSyncRunRepository } from '../src/data/syncRunRepository';

async function main(): Promise<void> {
  const pool = new Pool(getDatabasePoolConfig());
  const repository = new PostgresSyncRunRepository({ pool });

  try {
    const syncRun = await repository.getLatestSyncRun();

    if (!syncRun) {
      console.info('No sync runs found.');
      return;
    }

    console.info(
      `Latest sync run: status=${syncRun.status}` +
        ` startedAt=${syncRun.startedAt.toISOString()}` +
        ` finishedAt=${syncRun.finishedAt ? syncRun.finishedAt.toISOString() : 'null'}` +
        ` source=${syncRun.source}` +
        ` found=${syncRun.itemsFound}` +
        ` saved=${syncRun.itemsSaved}` +
        (syncRun.errorMessage ? ` error="${syncRun.errorMessage}"` : ''),
    );
  } finally {
    await pool.end();
  }
}

function getDatabasePoolConfig(): { connectionString: string } | undefined {
  return process.env.DATABASE_URL ? { connectionString: process.env.DATABASE_URL } : undefined;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Could not load latest sync run.');
  process.exitCode = 1;
});
