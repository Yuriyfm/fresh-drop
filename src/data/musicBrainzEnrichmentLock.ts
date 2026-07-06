import type { Pool, PoolClient } from 'pg';

const MUSICBRAINZ_ENRICHMENT_LOCK_KEY = 74362155;

type LockClient = Pool | PoolClient;

export async function tryAcquireMusicBrainzEnrichmentLock(client: LockClient): Promise<boolean> {
  const result = await client.query<{ locked: boolean }>(
    'select pg_try_advisory_lock($1) as locked',
    [MUSICBRAINZ_ENRICHMENT_LOCK_KEY],
  );

  return result.rows[0]?.locked ?? false;
}

export async function acquireMusicBrainzEnrichmentLock(client: LockClient): Promise<void> {
  await client.query('select pg_advisory_lock($1)', [MUSICBRAINZ_ENRICHMENT_LOCK_KEY]);
}

export async function releaseMusicBrainzEnrichmentLock(client: LockClient): Promise<void> {
  await client.query('select pg_advisory_unlock($1)', [MUSICBRAINZ_ENRICHMENT_LOCK_KEY]);
}
