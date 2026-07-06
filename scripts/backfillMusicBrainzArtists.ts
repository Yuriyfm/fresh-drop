import process from 'node:process';
import { Pool } from 'pg';
import { PostgresArtistEnrichmentRepository } from '../src/data/postgresArtistEnrichmentRepository';
import { acquireMusicBrainzEnrichmentLock, releaseMusicBrainzEnrichmentLock } from '../src/data/musicBrainzEnrichmentLock';
import { runMusicBrainzArtistEnrichmentWorker } from '../src/enrichment/musicBrainzArtistEnrichmentWorker';
import { MusicBrainzClient } from '../src/integrations/musicbrainz/musicbrainzClient';
import { getMusicBrainzConfigFromEnv } from '../src/integrations/musicbrainz/musicbrainzConfig';

type CliArgs = {
  batchSize: number;
  maxArtists?: number;
  dryRun: boolean;
  force: boolean;
};

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const config = getMusicBrainzConfigFromEnv(process.env);
  const pool = new Pool(getDatabasePoolConfig());
  let lockAcquired = false;

  try {
    await acquireMusicBrainzEnrichmentLock(pool);
    lockAcquired = true;

    const repository = new PostgresArtistEnrichmentRepository({ pool });
    const client = new MusicBrainzClient({
      baseUrl: config.baseUrl,
      userAgent: config.userAgent,
      rateLimitMs: config.rateLimitMs,
      timeoutMs: config.requestTimeoutMs,
    });

    const queued = await repository.backfillMissingArtists({
      enabled: config.enabled,
      limit: args.maxArtists,
      dryRun: args.dryRun,
    });

    console.info(
      `MusicBrainz backfill queued missing artists:` +
        ` queued=${queued}` +
        ` dryRun=${args.dryRun}` +
        ` force=${args.force}` +
        ` batchSize=${args.batchSize}` +
        ` maxArtists=${args.maxArtists ?? 'all'}`,
    );

    if (!config.enabled) {
      console.info('MusicBrainz backfill skipped worker run because enrichment is disabled.');
      return;
    }

    if (queued === 0 && !args.force) {
      console.info('MusicBrainz backfill found no missing artists to queue.');
      return;
    }

    let processedTotal = 0;
    const maxArtists = args.maxArtists;

    while (true) {
      const remaining = maxArtists === undefined ? args.batchSize : maxArtists - processedTotal;

      if (remaining <= 0) {
        break;
      }

      const summary = await runMusicBrainzArtistEnrichmentWorker(client, repository, {
        enabled: config.enabled,
        limit: Math.min(args.batchSize, remaining),
        dryRun: args.dryRun,
        force: args.force,
        urlLookupBatchSize: config.urlLookupBatchSize,
      });

      processedTotal += summary.processedArtists;

      if (summary.processedArtists === 0 || summary.processedArtists < Math.min(args.batchSize, remaining)) {
        break;
      }
    }

    console.info(`MusicBrainz backfill finished: processedArtists=${processedTotal}`);
  } finally {
    if (lockAcquired) {
      await releaseMusicBrainzEnrichmentLock(pool);
    }

    await pool.end();
  }
}

function parseArgs(args: string[]): CliArgs {
  let batchSize = 100;
  let maxArtists: number | undefined;
  let dryRun = false;
  let force = false;

  for (const arg of args) {
    if (arg === '--dry-run') {
      dryRun = true;
      continue;
    }

    if (arg === '--force') {
      force = true;
      continue;
    }

    if (arg.startsWith('--batch-size=')) {
      batchSize = parsePositiveInteger(arg.slice('--batch-size='.length), '--batch-size');
      continue;
    }

    if (arg.startsWith('--max-artists=')) {
      maxArtists = parsePositiveInteger(arg.slice('--max-artists='.length), '--max-artists');
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return { batchSize, maxArtists, dryRun, force };
}

function parsePositiveInteger(value: string, optionName: string): number {
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${optionName} must be a positive integer.`);
  }

  return parsed;
}

function getDatabasePoolConfig(): { connectionString: string } | undefined {
  return process.env.DATABASE_URL ? { connectionString: process.env.DATABASE_URL } : undefined;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'MusicBrainz backfill failed.');
  process.exitCode = 1;
});
