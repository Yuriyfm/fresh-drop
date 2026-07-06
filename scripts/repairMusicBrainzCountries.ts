import process from 'node:process';
import { Pool } from 'pg';
import { PostgresArtistEnrichmentRepository } from '../src/data/postgresArtistEnrichmentRepository';
import { normalizeCountryName } from '../src/domain/countryNames';
import { MusicBrainzClient } from '../src/integrations/musicbrainz/musicbrainzClient';
import { getMusicBrainzConfigFromEnv } from '../src/integrations/musicbrainz/musicbrainzConfig';

type RepairCandidateRow = {
  spotify_artist_id: string;
  musicbrainz_artist_mbid: string;
  musicbrainz_artist_country: string | null;
};

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
    const candidatesResult = await pool.query<RepairCandidateRow>(
      `
        select spotify_artist_id, musicbrainz_artist_mbid, musicbrainz_artist_country
        from artist_enrichment
        where match_status = 'matched'
          and musicbrainz_artist_mbid is not null
          and musicbrainz_artist_country is not null
        order by updated_at asc, spotify_artist_id asc
      `,
    );
    const candidates = candidatesResult.rows
      .filter((row) => normalizeCountryName(row.musicbrainz_artist_country) !== row.musicbrainz_artist_country?.trim())
      .slice(0, args.limit);

    console.info(`MusicBrainz country repair candidates=${candidates.length} dryRun=${args.dryRun}`);

    let repaired = 0;
    let cleared = 0;
    let failed = 0;

    for (const candidate of candidates) {
      try {
        const artistGenres = await client.lookupArtistGenres(candidate.musicbrainz_artist_mbid);

        if (!args.dryRun) {
          await repository.markMatched({
            spotifyArtistId: candidate.spotify_artist_id,
            musicBrainzArtistMbid: candidate.musicbrainz_artist_mbid,
            musicBrainzArtistName: artistGenres.musicBrainzArtistName,
            musicBrainzArtistCountry: artistGenres.musicBrainzArtistCountry,
            genres: artistGenres.genres,
            fetchedAt: new Date(),
          });
        }

        if (artistGenres.musicBrainzArtistCountry) {
          repaired += 1;
        } else {
          cleared += 1;
        }
      } catch (error) {
        failed += 1;
        console.error(
          `MusicBrainz country repair failed:` +
            ` artist=${candidate.spotify_artist_id}` +
            ` mbid=${candidate.musicbrainz_artist_mbid}` +
            ` error=${error instanceof Error ? error.message : 'unknown'}`,
        );
      }
    }

    console.info(
      `MusicBrainz country repair finished:` +
        ` repaired=${repaired}` +
        ` cleared=${cleared}` +
        ` failed=${failed}`,
    );
  } finally {
    await pool.end();
  }
}

function parseArgs(args: string[]): { limit: number; dryRun: boolean } {
  let limit = 100;
  let dryRun = false;

  for (const arg of args) {
    if (arg === '--dry-run') {
      dryRun = true;
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

  return { limit, dryRun };
}

function getDatabasePoolConfig(): { connectionString: string } | undefined {
  return process.env.DATABASE_URL ? { connectionString: process.env.DATABASE_URL } : undefined;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'MusicBrainz country repair failed.');
  process.exitCode = 1;
});
