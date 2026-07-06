import process from 'node:process';
import { Pool } from 'pg';

type ResetCounts = {
  releasesReset: number;
  artistsReset: number;
  enrichmentCountryCleared: number;
  enrichmentRequeued: number;
};

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const pool = new Pool(getDatabasePoolConfig());

  try {
    if (args.dryRun) {
      const counts = await collectResetCounts(pool);
      console.info(
        `Country reset dry run:` +
          ` releasesReset=${counts.releasesReset}` +
          ` artistsReset=${counts.artistsReset}` +
          ` enrichmentCountryCleared=${counts.enrichmentCountryCleared}` +
          ` enrichmentRequeued=${counts.enrichmentRequeued}`,
      );
      return;
    }

    const client = await pool.connect();

    try {
      await client.query('begin');

      const releasesResult = await client.query(
        `
          update releases
          set country = 'unknown',
              updated_at = now()
          where country is distinct from 'unknown'
        `,
      );
      const artistsResult = await client.query(
        `
          update artists
          set country = 'unknown',
              updated_at = now()
          where country is distinct from 'unknown'
        `,
      );
      const enrichmentResult = await client.query(
        `
          update artist_enrichment
          set musicbrainz_artist_country = null,
              match_status = case when match_status = 'disabled' then 'disabled' else 'pending' end,
              error_message = null,
              next_retry_at = null,
              retry_count = 0,
              updated_at = now()
          where musicbrainz_artist_country is not null
             or match_status <> case when match_status = 'disabled' then 'disabled' else 'pending' end
             or error_message is not null
             or next_retry_at is not null
             or retry_count <> 0
        `,
      );
      const requeuedResult = await client.query<{ total: number }>(
        `
          select count(*)::integer as total
          from artist_enrichment
          where match_status = 'pending'
        `,
      );

      await client.query('commit');

      console.info(
        `Country reset finished:` +
          ` releasesReset=${releasesResult.rowCount ?? 0}` +
          ` artistsReset=${artistsResult.rowCount ?? 0}` +
          ` enrichmentCountryCleared=${enrichmentResult.rowCount ?? 0}` +
          ` enrichmentRequeued=${requeuedResult.rows[0]?.total ?? 0}`,
      );
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

function parseArgs(args: string[]): { dryRun: boolean } {
  let dryRun = false;

  for (const arg of args) {
    if (arg === '--dry-run') {
      dryRun = true;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return { dryRun };
}

async function collectResetCounts(pool: Pool): Promise<ResetCounts> {
  const [releases, artists, enrichmentCountry, enrichmentRequeued] = await Promise.all([
    pool.query<{ total: number }>(
      `
        select count(*)::integer as total
        from releases
        where country is distinct from 'unknown'
      `,
    ),
    pool.query<{ total: number }>(
      `
        select count(*)::integer as total
        from artists
        where country is distinct from 'unknown'
      `,
    ),
    pool.query<{ total: number }>(
      `
        select count(*)::integer as total
        from artist_enrichment
        where musicbrainz_artist_country is not null
      `,
    ),
    pool.query<{ total: number }>(
      `
        select count(*)::integer as total
        from artist_enrichment
        where match_status <> 'disabled'
      `,
    ),
  ]);

  return {
    releasesReset: releases.rows[0]?.total ?? 0,
    artistsReset: artists.rows[0]?.total ?? 0,
    enrichmentCountryCleared: enrichmentCountry.rows[0]?.total ?? 0,
    enrichmentRequeued: enrichmentRequeued.rows[0]?.total ?? 0,
  };
}

function getDatabasePoolConfig(): { connectionString: string } | undefined {
  return process.env.DATABASE_URL ? { connectionString: process.env.DATABASE_URL } : undefined;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Country reset failed.');
  process.exitCode = 1;
});
