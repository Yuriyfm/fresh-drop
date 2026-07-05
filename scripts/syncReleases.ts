import process from 'node:process';
import { Pool } from 'pg';
import { PostgresReleaseRepository } from '../src/data/postgresReleaseRepository';
import { PostgresSyncRunRepository } from '../src/data/syncRunRepository';
import { getMusicBrainzConfigFromEnv } from '../src/integrations/musicbrainz/musicbrainzConfig';
import { SpotifyApiAdapter } from '../src/spotify/spotifyApiAdapter';
import { createReleaseSyncService } from '../src/sync/releaseSyncService';
import { getReleaseSyncConfigFromEnv } from '../src/sync/syncConfig';

async function main(): Promise<void> {
  const config = getReleaseSyncConfigFromEnv(process.env);
  const musicBrainzConfig = getMusicBrainzConfigFromEnv(process.env);
  const pool = new Pool(getDatabasePoolConfig());

  try {
    const spotify = new SpotifyApiAdapter(config.spotify);
    const releases = new PostgresReleaseRepository({ pool, artistEnrichmentEnabled: musicBrainzConfig.enabled });
    const syncRuns = new PostgresSyncRunRepository({ pool });
    const service = createReleaseSyncService(spotify, releases, syncRuns);

    console.info(
      `Starting release sync: market=${config.fetchOptions.market}` +
        ` limit=${config.fetchOptions.limit}` +
        ` pages=${config.fetchOptions.pages}`,
    );

    const result = await service.syncFreshReleases(config.fetchOptions);

    console.info(
      `Release sync ${result.status}: found=${result.itemsFound} saved=${result.itemsSaved}` +
        ` deleted=${result.itemsDeleted}` +
        ` releases=${result.smoke.releases}` +
        ` artists=${result.smoke.artists}` +
        ` unknownCountryReleases=${result.smoke.releasesUnknownCountry}` +
        ` unknownCountryArtists=${result.smoke.artistsUnknownCountry}` +
        ` nullPopularityReleases=${result.smoke.releasesNullPopularity}` +
        ` nullPopularityArtists=${result.smoke.artistsNullPopularity}` +
        (result.errorMessage ? ` error="${result.errorMessage}"` : ''),
    );

    if (result.status === 'failed') {
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
  console.error(error instanceof Error ? error.message : 'Release sync failed.');
  process.exitCode = 1;
});
