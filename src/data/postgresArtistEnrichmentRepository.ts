import { Pool, type PoolClient } from 'pg';
import type { ArtistEnrichmentQueueItem } from '../enrichment/artistEnrichment';
import type {
  ArtistEnrichmentCandidate,
  ArtistEnrichmentQueueWriter,
  ArtistEnrichmentRepository,
} from './artistEnrichmentRepository';
import { rebuildReleaseGenresForArtistIds } from './releaseGenreMaterializer';
import type { MusicBrainzGenre } from '../integrations/musicbrainz/musicbrainzGenres';

type PostgresArtistEnrichmentRepositoryOptions = {
  pool: Pool;
};

type ArtistEnrichmentRow = {
  spotify_artist_id: string;
  spotify_artist_name: string | null;
  spotify_artist_url: string;
  match_status: ArtistEnrichmentCandidate['matchStatus'];
  retry_count: number;
};

export class PostgresArtistEnrichmentRepository implements ArtistEnrichmentRepository, ArtistEnrichmentQueueWriter {
  private readonly pool: Pool;

  constructor(options: PostgresArtistEnrichmentRepositoryOptions) {
    this.pool = options.pool;
  }

  async queueArtists(artists: ArtistEnrichmentQueueItem[], options: { enabled: boolean }): Promise<void> {
    if (artists.length === 0) {
      return;
    }

    const client = await this.pool.connect();

    try {
      await client.query('begin');
      await upsertArtistEnrichmentQueue(client, artists, options);
      await client.query('commit');
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  async countArtistsForProcessing(options: { force?: boolean; now?: Date }): Promise<number> {
    const now = options.now ?? new Date();
    const result = await this.pool.query<{ total: number }>(
      `
        select count(*)::integer as total
        from artist_enrichment ae
        where ${buildProcessingWhereClause(options.force ?? false)}
      `,
      buildProcessingParams(options.force ?? false, now),
    );

    return result.rows[0]?.total ?? 0;
  }

  async findArtistsForProcessing(options: { limit: number; force?: boolean; now?: Date }): Promise<ArtistEnrichmentCandidate[]> {
    const now = options.now ?? new Date();
    const result = await this.pool.query<ArtistEnrichmentRow>(
      `
        select spotify_artist_id, spotify_artist_name, spotify_artist_url, match_status, retry_count
        from artist_enrichment ae
        where ${buildProcessingWhereClause(options.force ?? false)}
        order by
          case ae.match_status
            when 'pending' then 0
            when 'failed' then 1
            when 'not_found' then 2
            when 'ambiguous' then 3
            when 'matched' then 4
            else 5
          end asc,
          ae.updated_at asc,
          ae.spotify_artist_id asc
        limit $${buildProcessingParams(options.force ?? false, now).length + 1}
      `,
      [...buildProcessingParams(options.force ?? false, now), options.limit],
    );

    return result.rows.map((row) => ({
      spotifyArtistId: row.spotify_artist_id,
      spotifyArtistName: row.spotify_artist_name,
      spotifyArtistUrl: row.spotify_artist_url,
      matchStatus: row.match_status,
      retryCount: row.retry_count,
    }));
  }

  async markMatched(input: {
    spotifyArtistId: string;
    musicBrainzArtistMbid: string;
    musicBrainzArtistName?: string;
    genres: MusicBrainzGenre[];
    fetchedAt?: Date;
  }): Promise<void> {
    const client = await this.pool.connect();

    try {
      await client.query('begin');
      await client.query(
        `
          update artist_enrichment
          set musicbrainz_artist_mbid = $2,
              musicbrainz_artist_name = $3,
              genres = $4::jsonb,
              match_status = 'matched',
              match_method = 'spotify_url_lookup',
              error_message = null,
              fetched_at = $5,
              next_retry_at = null,
              retry_count = 0,
              updated_at = now()
          where spotify_artist_id = $1
        `,
        [
          input.spotifyArtistId,
          input.musicBrainzArtistMbid,
          input.musicBrainzArtistName ?? null,
          JSON.stringify(input.genres),
          input.fetchedAt ?? new Date(),
        ],
      );
      await rebuildReleaseGenresForArtistIds(client, [input.spotifyArtistId]);
      await client.query('commit');
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  async markNotFound(input: { spotifyArtistId: string; fetchedAt?: Date }): Promise<void> {
    await this.updateTerminalStatus(input.spotifyArtistId, 'not_found', input.fetchedAt ?? new Date(), null);
  }

  async markAmbiguous(input: { spotifyArtistId: string; fetchedAt?: Date; errorMessage?: string }): Promise<void> {
    await this.updateTerminalStatus(input.spotifyArtistId, 'ambiguous', input.fetchedAt ?? new Date(), input.errorMessage ?? null);
  }

  async markFailed(input: { spotifyArtistId: string; errorMessage: string; now?: Date }): Promise<void> {
    const client = await this.pool.connect();
    const now = input.now ?? new Date();

    try {
      await client.query('begin');
      const result = await client.query<{ retry_count: number }>(
        `
          update artist_enrichment
          set match_status = 'failed',
              error_message = $2,
              retry_count = retry_count + 1,
              next_retry_at = $3,
              updated_at = now()
          where spotify_artist_id = $1
          returning retry_count
        `,
        [input.spotifyArtistId, input.errorMessage, getNextRetryAt(now, 1)],
      );
      const retryCount = result.rows[0]?.retry_count ?? 1;

      await client.query(
        `
          update artist_enrichment
          set next_retry_at = $2
          where spotify_artist_id = $1
        `,
        [input.spotifyArtistId, getNextRetryAt(now, retryCount)],
      );
      await rebuildReleaseGenresForArtistIds(client, [input.spotifyArtistId]);
      await client.query('commit');
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  private async updateTerminalStatus(
    spotifyArtistId: string,
    status: 'not_found' | 'ambiguous',
    fetchedAt: Date,
    errorMessage: string | null,
  ): Promise<void> {
    const client = await this.pool.connect();

    try {
      await client.query('begin');
      await client.query(
        `
          update artist_enrichment
          set musicbrainz_artist_mbid = null,
              musicbrainz_artist_name = null,
              genres = '[]'::jsonb,
              match_status = $2,
              match_method = 'spotify_url_lookup',
              error_message = $3,
              fetched_at = $4,
              next_retry_at = null,
              retry_count = 0,
              updated_at = now()
          where spotify_artist_id = $1
        `,
        [spotifyArtistId, status, errorMessage, fetchedAt],
      );
      await rebuildReleaseGenresForArtistIds(client, [spotifyArtistId]);
      await client.query('commit');
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }
}

export async function upsertArtistEnrichmentQueue(
  client: PoolClient,
  artists: ArtistEnrichmentQueueItem[],
  options: { enabled: boolean },
): Promise<void> {
  const uniqueArtists = Array.from(new Map(artists.map((artist) => [artist.spotifyArtistId, artist])).values());

  for (const artist of uniqueArtists) {
    await client.query(
      `
        insert into artist_enrichment (
          spotify_artist_id,
          spotify_artist_name,
          spotify_artist_url,
          match_status,
          updated_at
        )
        values ($1, $2, $3, $4, now())
        on conflict (spotify_artist_id) do update set
          spotify_artist_name = excluded.spotify_artist_name,
          spotify_artist_url = excluded.spotify_artist_url,
          updated_at = now()
      `,
      [
        artist.spotifyArtistId,
        artist.spotifyArtistName,
        artist.spotifyArtistUrl,
        options.enabled ? 'pending' : 'disabled',
      ],
    );
  }
}

export function getNextRetryAt(now: Date, retryCount: number): Date {
  const delayMs = retryCount === 1
    ? 15 * 60 * 1000
    : retryCount === 2
      ? 60 * 60 * 1000
      : retryCount === 3
        ? 6 * 60 * 60 * 1000
        : 24 * 60 * 60 * 1000;

  return new Date(now.getTime() + delayMs);
}

function buildProcessingWhereClause(force: boolean): string {
  if (force) {
    return "ae.match_status <> 'disabled'";
  }

  return "(ae.match_status = 'pending' or (ae.match_status = 'failed' and (ae.next_retry_at is null or ae.next_retry_at <= $1)))";
}

function buildProcessingParams(force: boolean, now: Date): unknown[] {
  return force ? [] : [now];
}
