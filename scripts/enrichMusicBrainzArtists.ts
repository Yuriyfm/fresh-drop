import process from 'node:process';
import { Pool } from 'pg';
import { PostgresArtistEnrichmentRepository } from '../src/data/postgresArtistEnrichmentRepository';
import { runMusicBrainzArtistEnrichmentWorker } from '../src/enrichment/musicBrainzArtistEnrichmentWorker';
import { MusicBrainzClient } from '../src/integrations/musicbrainz/musicbrainzClient';
import { getMusicBrainzConfigFromEnv } from '../src/integrations/musicbrainz/musicbrainzConfig';

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const config = getMusicBrainzConfigFromEnv(process.env);
  const pool = new Pool(getDatabasePoolConfig());

  try {
    const repository = new PostgresArtistEnrichmentRepository({ pool });
    const client = new MusicBrainzClient({
      baseUrl: config.baseUrl,
      userAgent: config.userAgent,
      rateLimitMs: config.rateLimitMs,
      timeoutMs: config.requestTimeoutMs,
    });

    await runMusicBrainzArtistEnrichmentWorker(client, repository, {
      enabled: config.enabled,
      limit: args.limit,
      dryRun: args.dryRun,
      force: args.force,
      urlLookupBatchSize: config.urlLookupBatchSize,
    });
  } finally {
    await pool.end();
  }
}

function parseArgs(args: string[]): { limit: number; dryRun: boolean; force: boolean } {
  let limit = 100;
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

    if (arg.startsWith('--limit=')) {
      const parsed = Number(arg.slice('--limit='.length));

      if (!Number.isInteger(parsed) || parsed < 1) {
        throw new Error('--limit must be a positive integer.');
      }

      limit = parsed;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return { limit, dryRun, force };
}

function getDatabasePoolConfig(): { connectionString: string } | undefined {
  return process.env.DATABASE_URL ? { connectionString: process.env.DATABASE_URL } : undefined;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'MusicBrainz artist enrichment failed.');
  process.exitCode = 1;
});
